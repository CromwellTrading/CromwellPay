const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

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
console.log('✅ Supabase client inicializado');

// ============================================
// CONFIGURACIÓN JWT
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'cromwell_pay_secret_key_production_2024';
const JWT_EXPIRES_IN = '7d';

// ============================================
// CONFIGURACIÓN NODEMAILER (GMAIL REAL)
// ============================================
console.log('📧 Configurando Nodemailer con Gmail...');
let transporter;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    
    console.log('✅ Nodemailer configurado con Gmail');
} else {
    console.log('⚠️  Variables de email no configuradas');
    transporter = null;
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(bodyParser.json());
app.use(express.static('public'));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ============================================
// FUNCIONES DE AYUDA
// ============================================
function generateVerificationCode() {
    return crypto.randomInt(100000, 999999).toString();
}

function generateUserId() {
    return 'CROM-' + Math.floor(1000 + Math.random() * 9000);
}

async function sendVerificationEmail(email, code) {
    if (!transporter) {
        console.log(`⚠️  Email no configurado. Código para ${email}: ${code}`);
        console.log(`💡 Configura EMAIL_USER y EMAIL_PASS en Render para enviar emails reales`);
        return false;
    }

    try {
        const mailOptions = {
            from: `"Cromwell Pay" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Código de Verificación - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #00ff9d;">¡Bienvenido a Cromwell Pay!</h2>
                    <p>Tu código de verificación es: <strong style="font-size: 24px;">${code}</strong></p>
                    <p>Este código expira en 15 minutos.</p>
                    <p>Si no solicitaste este código, ignora este mensaje.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Email enviado a ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email:', error.message);
        console.log(`📧 Código para ${email}: ${code}`);
        return false;
    }
}

// ============================================
// ENDPOINTS DE AUTENTICACIÓN
// ============================================

// 1. REGISTRO DE USUARIO
app.post('/api/register', async (req, res) => {
    console.log('📝 Registro:', req.body.email);
    
    try {
        const { email, password, termsAccepted } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }

        if (!termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes aceptar los términos' 
            });
        }

        // Verificar si usuario existe
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email.toLowerCase())
            .single();

        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email ya registrado' 
            });
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
            accepted_terms: true,
            created_at: new Date().toISOString()
        };

        const { data: createdUser, error: createError } = await supabase
            .from('users')
            .insert([newUser])
            .select()
            .single();

        if (createError) {
            console.error('❌ Error al crear usuario:', createError);
            
            // Si es error de RLS, instrucciones claras
            if (createError.code === '42501') {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error de permisos (RLS). Ejecuta en Supabase SQL: ALTER TABLE users DISABLE ROW LEVEL SECURITY;' 
                });
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear usuario' 
            });
        }

        // Generar y guardar código
        const verificationCode = generateVerificationCode();
        
        await supabase
            .from('verification_codes')
            .insert([{
                email: email.toLowerCase(),
                code: verificationCode,
                expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
            }]);

        // Enviar email REAL
        const emailSent = await sendVerificationEmail(email, verificationCode);

        res.json({ 
            success: true, 
            message: emailSent 
                ? 'Registro exitoso. Verifica tu email.'
                : 'Registro exitoso. Revisa la consola para el código de verificación.',
            emailSent: emailSent
        });

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 2. LOGIN DE USUARIO
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login:', req.body.email);
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña requeridos' 
            });
        }

        // Buscar usuario
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        // Verificar contraseña
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        // Verificar si está verificado
        if (!user.verified) {
            return res.status(403).json({ 
                success: false, 
                message: 'Verifica tu email primero' 
            });
        }

        // Generar token
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role || 'user',
                verified: user.verified 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Login exitoso',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. VERIFICACIÓN DE EMAIL
app.post('/api/verify', async (req, res) => {
    console.log('🔐 Verificación:', req.body.email);
    
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y código requeridos' 
            });
        }

        // Buscar código
        const { data: verification } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .single();

        if (!verification) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código inválido' 
            });
        }

        // Verificar expiración
        if (new Date(verification.expires_at) < new Date()) {
            await supabase.from('verification_codes').delete().eq('id', verification.id);
            return res.status(400).json({ 
                success: false, 
                message: 'Código expirado' 
            });
        }

        // Marcar como verificado
        await supabase
            .from('users')
            .update({ 
                verified: true,
                verification_attempts: 0
            })
            .eq('email', email.toLowerCase());

        // Eliminar código
        await supabase.from('verification_codes').delete().eq('id', verification.id);

        // Buscar usuario para token
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
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: '¡Email verificado exitosamente!',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error en verificación:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 4. REENVIAR CÓDIGO
app.post('/api/resend-code', async (req, res) => {
    console.log('🔄 Reenviando código:', req.body.email);
    
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email requerido' 
            });
        }

        // Verificar usuario
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        if (user.verified) {
            return res.json({ 
                success: true, 
                message: 'Usuario ya verificado' 
            });
        }

        // Eliminar códigos anteriores
        await supabase
            .from('verification_codes')
            .delete()
            .eq('email', email.toLowerCase());

        // Generar nuevo código
        const verificationCode = generateVerificationCode();
        
        // Guardar código
        await supabase
            .from('verification_codes')
            .insert([{
                email: email.toLowerCase(),
                code: verificationCode,
                expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
            }]);

        // Enviar email
        await sendVerificationEmail(email, verificationCode);

        res.json({ 
            success: true, 
            message: 'Código reenviado' 
        });

    } catch (error) {
        console.error('❌ Error al reenviar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ============================================
// ENDPOINTS DE ADMINISTRACIÓN
// ============================================

// 5. CREAR USUARIO ADMIN (PRIMERA VEZ)
app.post('/api/admin/create', async (req, res) => {
    console.log('👤 Creando admin...');
    
    try {
        const adminEmail = 'cromwellpayclient@gmail.com';
        const adminPassword = 'V3ry$tr0ngP@$$w0rd_2024@Admin';

        // Verificar si ya existe
        const { data: existingAdmin } = await supabase
            .from('users')
            .select('*')
            .eq('email', adminEmail)
            .single();

        if (existingAdmin) {
            return res.json({ 
                success: true, 
                message: 'Admin ya existe',
                email: adminEmail
            });
        }

        // Crear admin
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const adminUser = {
            user_id: 'CROM-0001',
            email: adminEmail,
            password_hash: hashedPassword,
            verified: true,
            role: 'admin',
            cwt: 1000,
            cws: 5000,
            nickname: 'Administrador',
            phone: '+0000000000',
            province: 'Admin',
            accepted_terms: true,
            created_at: new Date().toISOString()
        };

        const { data: createdAdmin, error: createError } = await supabase
            .from('users')
            .insert([adminUser])
            .select()
            .single();

        if (createError) {
            console.error('❌ Error al crear admin:', createError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear admin. Verifica RLS en Supabase.' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Admin creado exitosamente',
            admin: {
                email: createdAdmin.email,
                password: adminPassword,
                role: createdAdmin.role
            }
        });

    } catch (error) {
        console.error('❌ Error al crear admin:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ============================================
// ENDPOINTS ADICIONALES
// ============================================

// 6. ESTADO DEL SERVIDOR
app.get('/api/status', async (req, res) => {
    try {
        res.json({
            success: true,
            status: 'online',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            success: false,
            status: 'error',
            message: error.message
        });
    }
});

// 7. VERIFICAR TOKEN
app.post('/api/verify-token', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token inválido' });
        }
        res.json({ success: true, user });
    });
});

// ============================================
// RUTAS DE FALLBACK
// ============================================
app.get('*', (req, res) => {
    res.sendFile(req.path, { root: 'public' }, (err) => {
        if (err) {
            res.redirect('/login.html');
        }
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`🚀 SERVIDOR CROMWELL PAY INICIADO`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('========================================');
    console.log('🔧 Pasos requeridos:');
    console.log('1. Deshabilita RLS en Supabase:');
    console.log('   ALTER TABLE users DISABLE ROW LEVEL SECURITY;');
    console.log('   ALTER TABLE verification_codes DISABLE ROW LEVEL SECURITY;');
    console.log('2. Crea admin (solo primera vez):');
    console.log(`   POST ${process.env.URL || 'http://localhost:' + PORT}/api/admin/create`);
    console.log('3. Configura email en variables de entorno:');
    console.log('   EMAIL_USER=tu-email@gmail.com');
    console.log('   EMAIL_PASS=tu-contraseña-app');
    console.log('========================================');
});
