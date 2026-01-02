const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURACIÓN
// ============================================
console.log('🔧 === INICIANDO CROMWELL PAY ===');
console.log('📊 Puerto:', PORT);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('🚨 ERROR: Faltan variables de Supabase');
    process.exit(1);
}

// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase inicializado');

// ============================================
// CONFIGURACIÓN EMAIL
// ============================================
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log('✅ Email configurado');
} else {
    console.log('⚠️  Email no configurado - usando consola');
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Logs
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// ============================================
// FUNCIONES
// ============================================
function generateVerificationCode() {
    return crypto.randomInt(100000, 999999).toString();
}

function generateUserId() {
    return 'CROM-' + Math.floor(1000 + Math.random() * 9000);
}

async function sendVerificationEmail(email, code) {
    if (!transporter) {
        console.log(`📧 Código para ${email}: ${code}`);
        return false;
    }

    try {
        await transporter.sendMail({
            from: `"Cromwell Pay" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Código de Verificación - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif;">
                    <h2 style="color: #00ff9d;">¡Bienvenido a Cromwell Pay!</h2>
                    <p>Tu código de verificación es: <strong style="font-size: 24px;">${code}</strong></p>
                    <p>Expira en 15 minutos.</p>
                </div>
            `
        });
        console.log(`✅ Email enviado a ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Error email:', error.message);
        console.log(`📧 Código para ${email}: ${code}`);
        return false;
    }
}

// ============================================
// CREAR ADMIN AL INICIAR
// ============================================
async function createAdminIfNotExists() {
    try {
        const adminEmail = 'cromwellpayclient@gmail.com';
        
        // Verificar si existe
        const { data: admin } = await supabase
            .from('users')
            .select('*')
            .eq('email', adminEmail)
            .single();
            
        if (admin) {
            console.log('✅ Admin ya existe:', adminEmail);
            return;
        }
        
        // Crear admin
        console.log('👤 Creando admin...');
        const hashedPassword = await bcrypt.hash('V3ry$tr0ngP@$$w0rd_2024@Admin', 10);
        
        const { error } = await supabase.from('users').insert([{
            user_id: 'CROM-0001',
            email: adminEmail,
            password_hash: hashedPassword,
            verified: true,
            role: 'admin',
            cwt: 1000,
            cws: 5000,
            nickname: 'Admin Cromwell',
            phone: 'N/A',
            province: 'Admin',
            accepted_terms: true
        }]);
        
        if (error) {
            console.error('❌ Error creando admin:', error.message);
            return;
        }
        
        console.log('✅ Admin creado');
        console.log('📧 Email:', adminEmail);
        console.log('🔑 Contraseña: V3ry$tr0ngP@$$w0rd_2024@Admin');
        
    } catch (error) {
        console.error('⚠️  Error creando admin:', error.message);
    }
}

// ============================================
// RUTAS WEB
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ============================================
// API ENDPOINTS
// ============================================

// 1. REGISTRO
app.post('/api/register', async (req, res) => {
    console.log('📝 Registro:', req.body.email);
    
    try {
        const { email, password, termsAccepted } = req.body;

        if (!email || !password || !termsAccepted) {
            return res.json({ success: false, message: 'Completa todos los campos' });
        }

        // Verificar si existe
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email.toLowerCase())
            .single();

        if (existingUser) {
            return res.json({ success: false, message: 'Email ya registrado' });
        }

        // Crear usuario
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            user_id: generateUserId(),
            email: email.toLowerCase(),
            password_hash: hashedPassword,
            verified: false,
            role: 'user',
            cwt: 0,
            cws: 0,
            accepted_terms: true
        };

        const { error } = await supabase
            .from('users')
            .insert([newUser]);

        if (error) {
            console.error('❌ Error creando usuario:', error);
            
            if (error.code === '42501') {
                return res.json({ 
                    success: false, 
                    message: 'Error de permisos. Ejecuta en Supabase: ALTER TABLE users DISABLE ROW LEVEL SECURITY;' 
                });
            }
            
            return res.json({ success: false, message: 'Error al crear usuario' });
        }

        // Generar código
        const verificationCode = generateVerificationCode();
        
        await supabase.from('verification_codes').insert([{
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        // Enviar email
        await sendVerificationEmail(email, verificationCode);

        res.json({ 
            success: true, 
            message: 'Registro exitoso. Verifica tu email.' 
        });

    } catch (error) {
        console.error('❌ Error registro:', error);
        res.json({ success: false, message: 'Error interno' });
    }
});

// 2. LOGIN
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login:', req.body.email);
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({ success: false, message: 'Email y contraseña requeridos' });
        }

        // Buscar usuario
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.json({ success: false, message: 'Credenciales incorrectas' });
        }

        // Verificar contraseña
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.json({ success: false, message: 'Credenciales incorrectas' });
        }

        // Verificar email
        if (!user.verified) {
            return res.json({ success: false, message: 'Verifica tu email primero' });
        }

        // Token
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role || 'user',
                verified: user.verified 
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Login exitoso',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error login:', error);
        res.json({ success: false, message: 'Error interno' });
    }
});

// 3. VERIFICACIÓN
app.post('/api/verify', async (req, res) => {
    console.log('🔐 Verificación:', req.body.email);
    
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.json({ success: false, message: 'Email y código requeridos' });
        }

        // Buscar código
        const { data: verification } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .single();

        if (!verification) {
            return res.json({ success: false, message: 'Código inválido' });
        }

        // Verificar expiración
        if (new Date(verification.expires_at) < new Date()) {
            await supabase.from('verification_codes').delete().eq('id', verification.id);
            return res.json({ success: false, message: 'Código expirado' });
        }

        // Marcar como verificado
        await supabase
            .from('users')
            .update({ verified: true })
            .eq('email', email.toLowerCase());

        // Eliminar código
        await supabase.from('verification_codes').delete().eq('id', verification.id);

        // Buscar usuario
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role || 'user',
                verified: true 
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: '¡Email verificado!',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error verificación:', error);
        res.json({ success: false, message: 'Error interno' });
    }
});

// 4. REENVIAR CÓDIGO
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.json({ success: false, message: 'Email requerido' });
        }

        // Eliminar códigos anteriores
        await supabase
            .from('verification_codes')
            .delete()
            .eq('email', email.toLowerCase());

        // Generar nuevo código
        const verificationCode = generateVerificationCode();
        
        // Guardar
        await supabase.from('verification_codes').insert([{
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        // Enviar
        await sendVerificationEmail(email, verificationCode);

        res.json({ success: true, message: 'Código reenviado' });

    } catch (error) {
        console.error('❌ Error reenviar:', error);
        res.json({ success: false, message: 'Error interno' });
    }
});

// 5. ESTADO
app.get('/api/status', (req, res) => {
    res.json({ success: true, status: 'online' });
});

// 6. VERIFICAR TOKEN
app.post('/api/verify-token', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'Token no proporcionado' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) {
            return res.json({ success: false, message: 'Token inválido' });
        }
        res.json({ success: true, user });
    });
});

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
    console.error('🔥 ERROR:', err);
    res.status(500).json({ success: false, message: 'Error interno' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, async () => {
    console.log('========================================');
    console.log(`🚀 SERVIDOR INICIADO EN PUERTO ${PORT}`);
    console.log('========================================');
    
    // Crear admin si no existe
    await createAdminIfNotExists();
    
    console.log('✅ Sistema listo');
    console.log('🔑 Admin: cromwellpayclient@gmail.com');
    console.log('🔑 Contraseña: V3ry$tr0ngP@$$w0rd_2024@Admin');
    console.log('========================================');
});
