const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

// Cargar variables de entorno
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURACIÓN INICIAL
// ============================================
console.log('🔧 === INICIANDO CROMWELL PAY ===');
console.log('📊 Puerto:', PORT);
console.log('🔄 Supabase URL:', process.env.SUPABASE_URL ? '✅ Configurada' : '❌ FALTA');
console.log('🔑 Supabase Key:', process.env.SUPABASE_SERVICE_KEY ? '✅ Configurada' : '❌ FALTA');
console.log('🔐 JWT Secret:', process.env.JWT_SECRET ? '✅ Configurado' : '❌ FALTA');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('🚨 ERROR CRÍTICO: Faltan variables de entorno de Supabase');
    process.exit(1);
}

// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    }
});

console.log('✅ Supabase client inicializado');

// ============================================
// CONFIGURACIÓN JWT
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'cromwell_pay_secret_key_production_2024';
const JWT_EXPIRES_IN = '7d';

// ============================================
// CONFIGURACIÓN NODEMAILER (ETHEAL PARA PRUEBAS)
// ============================================
console.log('📧 Configurando Nodemailer...');
let transporter;

async function initializeEmail() {
    try {
        // Usar Ethereal Email para pruebas (funciona sin credenciales reales)
        const testAccount = await nodemailer.createTestAccount();
        
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        
        console.log('✅ Ethereal Email configurado para pruebas:');
        console.log('   👤 Usuario:', testAccount.user);
        console.log('   🔑 Contraseña:', testAccount.pass);
        console.log('   🌐 Panel: https://ethereal.email');
        console.log('   💡 Los emails se generan pero NO se envían realmente');
        console.log('   💡 Puedes verlos en el panel de Ethereal');
        
        return transporter;
    } catch (error) {
        console.error('❌ Error configurando email:', error.message);
        console.log('⚠️  Continuando sin servicio de email...');
        return null;
    }
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: function(origin, callback) {
        // Permitir cualquier origen (útil para pruebas)
        callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.static('public'));

// Middleware de logs
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('❌ Error verificando token:', err.message);
            return res.status(403).json({ success: false, message: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
};

// Middleware de admin
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};

// ============================================
// FUNCIONES DE AYUDA
// ============================================
function generateVerificationCode() {
    return crypto.randomInt(100000, 999999).toString();
}

function generateUserId() {
    const prefix = 'CROM-';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return prefix + randomNum;
}

async function sendVerificationEmail(email, code) {
    if (!transporter) {
        console.log('⚠️  Transporter no disponible, usando código en consola');
        console.log(`📧 Código para ${email}: ${code}`);
        return true;
    }

    try {
        const info = await transporter.sendMail({
            from: '"Cromwell Pay" <noreply@cromwellpay.com>',
            to: email,
            subject: 'Código de Verificación - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #00ff9d;">¡Bienvenido a Cromwell Pay!</h2>
                    <p>Tu código de verificación es: <strong style="font-size: 24px; color: #ff3e80;">${code}</strong></p>
                    <p>Este código expira en 15 minutos.</p>
                    <p>Si no solicitaste este código, ignora este mensaje.</p>
                </div>
            `
        });

        console.log('✅ Email "enviado" (Ethereal):', nodemailer.getTestMessageUrl(info));
        console.log('💡 Ver el email en:', nodemailer.getTestMessageUrl(info));
        return true;
    } catch (error) {
        console.error('❌ Error al "enviar" email:', error.message);
        console.log(`📧 Código para ${email}: ${code}`);
        return false;
    }
}

// ============================================
// RUTAS PARA PÁGINAS HTML
// ============================================
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// ============================================
// ENDPOINTS DE AUTENTICACIÓN (SIMPLIFICADOS)
// ============================================

// 1. Registro de usuario (SIMPLIFICADO)
app.post('/api/register', async (req, res) => {
    console.log('📝 Intentando registro:', req.body.email);
    
    try {
        const { email, password, termsAccepted } = req.body;

        // Validaciones básicas
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }

        if (!termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes aceptar los términos y condiciones' 
            });
        }

        // Verificar si el usuario ya existe
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Este email ya está registrado' 
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
            nickname: '',
            phone: '',
            province: '',
            wallet: '',
            notifications: true,
            verification_attempts: 0,
            accepted_terms: true,
            created_at: new Date().toISOString()
        };

        console.log('👤 Insertando usuario en Supabase...');
        const { data: createdUser, error: createError } = await supabase
            .from('users')
            .insert([newUser])
            .select()
            .single();

        if (createError) {
            console.error('❌ Error al crear usuario:', createError);
            
            // Si es error de RLS, crear usuario de forma diferente
            if (createError.code === '42501') {
                console.log('⚠️  Error de permisos RLS, intentando crear admin primero...');
                return res.status(500).json({ 
                    success: false, 
                    message: 'Problema de permisos. Por favor crea primero un usuario admin.' 
                });
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear el usuario' 
            });
        }

        // Generar código de verificación
        const verificationCode = generateVerificationCode();
        console.log('🔑 Código generado:', verificationCode);
        
        // Guardar código en base de datos
        const verificationData = {
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
        };

        await supabase
            .from('verification_codes')
            .insert([verificationData]);

        // "Enviar" email (Ethereal para pruebas)
        console.log('📧 Simulando envío de email...');
        await sendVerificationEmail(email, verificationCode);

        console.log('✅ Registro exitoso para:', email);
        res.json({ 
            success: true, 
            message: 'Registro exitoso. Verifica tu correo electrónico.',
            note: 'Usando Ethereal Email para pruebas. Ver el código en consola o panel.'
        });

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor',
            error: error.message 
        });
    }
});

// 2. Login de usuario (SIMPLIFICADO)
app.post('/api/login', async (req, res) => {
    console.log('🔐 Intentando login para:', req.body.email);
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }

        // Buscar usuario
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            console.log('❌ Usuario no encontrado:', email);
            return res.status(404).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        // Verificar contraseña
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!passwordMatch) {
            console.log('❌ Contraseña incorrecta para:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        // Verificar si está verificado
        if (!user.verified) {
            console.log('⚠️  Usuario no verificado:', email);
            return res.status(403).json({ 
                success: false, 
                message: 'Debes verificar tu email primero. Revisa tu correo.' 
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

        // Eliminar contraseña de la respuesta
        const { password_hash, ...userWithoutPassword } = user;

        console.log('✅ Login exitoso para:', email);
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
            message: 'Error interno del servidor',
            error: error.message 
        });
    }
});

// 3. Verificación de email
app.post('/api/verify', async (req, res) => {
    console.log('🔐 Intentando verificación para:', req.body.email);
    
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y código son requeridos' 
            });
        }

        // Buscar código de verificación
        const { data: verification } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .single();

        if (!verification) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código de verificación inválido' 
            });
        }

        // Verificar expiración
        if (new Date(verification.expires_at) < new Date()) {
            await supabase.from('verification_codes').delete().eq('id', verification.id);
            return res.status(400).json({ 
                success: false, 
                message: 'El código ha expirado' 
            });
        }

        // Marcar usuario como verificado
        const { error: updateError } = await supabase
            .from('users')
            .update({ 
                verified: true,
                verification_attempts: 0
            })
            .eq('email', email.toLowerCase());

        if (updateError) {
            console.error('❌ Error al actualizar usuario:', updateError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al verificar el usuario' 
            });
        }

        // Eliminar código usado
        await supabase.from('verification_codes').delete().eq('id', verification.id);

        // Buscar usuario para generar token
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        // Generar token automáticamente
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

        console.log('✅ Verificación exitosa para:', email);
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

// 4. Reenviar código de verificación
app.post('/api/resend-code', async (req, res) => {
    console.log('🔄 Reenviando código para:', req.body.email);
    
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email es requerido' 
            });
        }

        // Verificar si el usuario existe
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
                message: 'El usuario ya está verificado' 
            });
        }

        // Eliminar códigos anteriores
        await supabase
            .from('verification_codes')
            .delete()
            .eq('email', email.toLowerCase());

        // Generar nuevo código
        const verificationCode = generateVerificationCode();
        console.log('🔑 Nuevo código generado:', verificationCode);
        
        // Guardar nuevo código
        const verificationData = {
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
        };

        await supabase
            .from('verification_codes')
            .insert([verificationData]);

        // "Enviar" email
        await sendVerificationEmail(email, verificationCode);

        console.log('✅ Código reenviado a:', email);
        res.json({ 
            success: true, 
            message: 'Se ha enviado un nuevo código de verificación.' 
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
// ENDPOINTS BÁSICOS
// ============================================

// 5. Dashboard del usuario
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            user: userWithoutPassword,
            dashboardData: {
                totalCWT: user.cwt || 0,
                totalCWS: user.cws || 0
            }
        });

    } catch (error) {
        console.error('❌ Error en dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 6. Verificar token
app.post('/api/verify-token', authenticateToken, async (req, res) => {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.user.id)
            .single();
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error al verificar token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 7. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        // Verificar conexión a Supabase
        const { data: users, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);

        const supabaseStatus = !error ? 'connected' : 'disconnected';

        res.json({
            success: true,
            status: 'online',
            timestamp: new Date().toISOString(),
            supabase: supabaseStatus,
            email: transporter ? 'ethereal_configured' : 'not_configured'
        });

    } catch (error) {
        res.json({
            success: false,
            status: 'error',
            message: error.message
        });
    }
});

// 8. Crear usuario admin inicial (SOLO UNA VEZ)
app.post('/api/admin/init', async (req, res) => {
    console.log('👤 Intentando crear usuario admin...');
    
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@cromwellpay.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
        const adminUserId = 'CROM-0001';

        // Verificar si ya existe
        const { data: existingAdmin } = await supabase
            .from('users')
            .select('*')
            .eq('email', adminEmail)
            .single();

        if (existingAdmin) {
            console.log('✅ Admin ya existe');
            return res.json({ 
                success: true, 
                message: 'Admin ya existe',
                admin: {
                    email: existingAdmin.email,
                    role: existingAdmin.role
                }
            });
        }

        // Crear admin
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const adminUser = {
            user_id: adminUserId,
            email: adminEmail,
            password_hash: hashedPassword,
            verified: true,
            role: 'admin',
            cwt: 1000,
            cws: 5000,
            nickname: 'Administrador',
            phone: '+0000000000',
            province: 'Admin',
            wallet: '',
            notifications: true,
            accepted_terms: true,
            created_at: new Date().toISOString()
        };

        console.log('👤 Insertando admin en Supabase...');
        const { data: createdAdmin, error: createError } = await supabase
            .from('users')
            .insert([adminUser])
            .select()
            .single();

        if (createError) {
            console.error('❌ Error al crear admin:', createError);
            
            // Si hay error de RLS, intentar crear tabla primero
            if (createError.code === '42P01') {
                console.log('⚠️  La tabla users no existe. Creándola...');
                return res.status(500).json({ 
                    success: false, 
                    message: 'La tabla users no existe. Crea las tablas en Supabase primero.' 
                });
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear admin',
                error: createError.message 
            });
        }

        console.log('✅ Admin creado exitosamente');
        res.json({ 
            success: true, 
            message: 'Admin creado exitosamente',
            admin: {
                email: createdAdmin.email,
                password: adminPassword, // SOLO PARA PRUEBAS
                role: createdAdmin.role,
                user_id: createdAdmin.user_id
            },
            warning: '¡Guarda estas credenciales en un lugar seguro!'
        });

    } catch (error) {
        console.error('❌ Error al crear admin:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al crear admin',
            error: error.message 
        });
    }
});

// 9. Verificar estructura de base de datos
app.get('/api/admin/check-db', async (req, res) => {
    console.log('🔍 Verificando estructura de base de datos...');
    
    try {
        // Verificar tabla users
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('count')
            .limit(1);
        
        // Verificar tabla verification_codes
        const { data: codes, error: codesError } = await supabase
            .from('verification_codes')
            .select('count')
            .limit(1);

        res.json({
            success: true,
            tables: {
                users: usersError ? 'missing' : 'exists',
                verification_codes: codesError ? 'missing' : 'exists'
            },
            rls_enabled: usersError && usersError.code === '42501' ? 'yes' : 'no'
        });

    } catch (error) {
        res.json({
            success: false,
            message: 'Error verificando base de datos',
            error: error.message
        });
    }
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
// INICIALIZACIÓN DEL SISTEMA
// ============================================
async function initializeSystem() {
    console.log('🚀 Inicializando sistema Cromwell Pay...');
    
    try {
        // 1. Inicializar email
        await initializeEmail();
        
        // 2. Verificar conexión a Supabase
        console.log('🔍 Verificando conexión a Supabase...');
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);
        
        if (error) {
            if (error.code === '42P01') {
                console.log('⚠️  Tabla users no existe. Crea las tablas en Supabase:');
                console.log(`
                -- Tabla users
                CREATE TABLE users (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    user_id TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    verified BOOLEAN DEFAULT false,
                    role TEXT DEFAULT 'user',
                    cwt DECIMAL DEFAULT 0,
                    cws INTEGER DEFAULT 0,
                    nickname TEXT,
                    phone TEXT,
                    province TEXT,
                    wallet TEXT,
                    notifications BOOLEAN DEFAULT true,
                    verification_attempts INTEGER DEFAULT 0,
                    accepted_terms BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                -- Tabla verification_codes
                CREATE TABLE verification_codes (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    email TEXT NOT NULL,
                    code TEXT NOT NULL,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                -- Deshabilitar RLS (temporalmente para desarrollo)
                ALTER TABLE users DISABLE ROW LEVEL SECURITY;
                ALTER TABLE verification_codes DISABLE ROW LEVEL SECURITY;
                `);
            } else if (error.code === '42501') {
                console.log('⚠️  RLS está habilitado. Deshabilítalo con:');
                console.log('    ALTER TABLE users DISABLE ROW LEVEL SECURITY;');
                console.log('    ALTER TABLE verification_codes DISABLE ROW LEVEL SECURITY;');
            }
        } else {
            console.log('✅ Conexión a Supabase verificada');
        }
        
        // 3. Intentar crear admin si no existe
        console.log('👤 Verificando usuario admin...');
        try {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@cromwellpay.com';
            const { data: admin } = await supabase
                .from('users')
                .select('*')
                .eq('email', adminEmail)
                .single();
            
            if (!admin) {
                console.log('ℹ️  Admin no existe. Crea uno con:');
                console.log('   POST /api/admin/init');
                console.log('   Credenciales por defecto:');
                console.log('   Email: admin@cromwellpay.com');
                console.log('   Password: Admin123!');
            } else {
                console.log('✅ Admin encontrado:', admin.email);
            }
        } catch (adminError) {
            console.log('⚠️  No se pudo verificar admin:', adminError.message);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error en inicialización:', error);
        return false;
    }
}

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, async () => {
    console.log('========================================');
    console.log(`🚀 SERVIDOR CROMWELL PAY INICIADO`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📧 Email: Ethereal (para pruebas)`);
    console.log(`🛡️  JWT: ${process.env.JWT_SECRET ? 'Configurado' : 'Por defecto'}`);
    console.log(`📊 Supabase: ${process.env.SUPABASE_URL ? 'Conectado' : 'No conectado'}`);
    console.log('========================================');
    
    // Inicializar sistema
    await initializeSystem();
    
    console.log('✅ Sistema listo para recibir peticiones');
    console.log('========================================');
    console.log('🔧 Para crear admin (primera vez):');
    console.log(`   POST ${process.env.URL || 'http://localhost:' + PORT}/api/admin/init`);
    console.log('========================================');
});
