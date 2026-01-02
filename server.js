const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
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

// Verificar variables críticas
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('🚨 ERROR: Variables de Supabase faltantes');
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
// CONFIGURACIÓN RESEND (INTERMEDIARIO PARA GMAIL)
// ============================================
let resendClient = null;
let emailConfigured = false;

if (process.env.RESEND_API_KEY && process.env.FROM_EMAIL) {
    try {
        resendClient = new Resend(process.env.RESEND_API_KEY);
        emailConfigured = true;
        console.log('✅ Resend configurado correctamente');
        console.log('📧 Emails se enviarán desde:', process.env.FROM_EMAIL);
    } catch (error) {
        console.error('❌ Error configurando Resend:', error.message);
        emailConfigured = false;
    }
} else {
    console.log('⚠️  Resend no configurado - usando modo consola');
    console.log('💡 Agrega RESEND_API_KEY y FROM_EMAIL en las variables de entorno');
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Logs de solicitudes
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleString()} - ${req.method} ${req.url}`);
    next();
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function generateVerificationCode() {
    return crypto.randomInt(100000, 999999).toString();
}

function generateUserId() {
    return 'CROM-' + Math.floor(1000 + Math.random() * 9000);
}

async function sendVerificationEmail(email, code) {
    if (!emailConfigured || !resendClient) {
        console.log(`📧 [MODO CONSOLA] Código para ${email}: ${code}`);
        console.log(`📧 [MODO CONSOLA] Expira en 15 minutos`);
        return { 
            success: true, 
            mode: 'console', 
            code: code 
        };
    }

    try {
        const emailData = {
            from: `Cromwell Pay <${process.env.FROM_EMAIL}>`,
            to: [email],
            subject: '✅ Tu Código de Verificación - Cromwell Pay',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Código de Verificación</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
                            margin: 0;
                            padding: 0;
                            color: #ffffff;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            background: rgba(20, 20, 30, 0.95);
                            border-radius: 20px;
                            overflow: hidden;
                            border: 1px solid rgba(0, 255, 157, 0.3);
                            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
                        }
                        .header {
                            background: linear-gradient(135deg, #00ff9d 0%, #00cc7a 100%);
                            padding: 40px;
                            text-align: center;
                            position: relative;
                            overflow: hidden;
                        }
                        .header::before {
                            content: '';
                            position: absolute;
                            top: -50%;
                            left: -50%;
                            width: 200%;
                            height: 200%;
                            background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
                            background-size: 20px 20px;
                            opacity: 0.3;
                            animation: gridMove 20s linear infinite;
                        }
                        .header h1 {
                            color: #0a0a0a;
                            margin: 0;
                            font-size: 36px;
                            font-weight: 800;
                            letter-spacing: 2px;
                            text-transform: uppercase;
                            position: relative;
                            z-index: 1;
                        }
                        .header p {
                            color: rgba(0, 0, 0, 0.8);
                            margin: 10px 0 0 0;
                            font-size: 16px;
                            position: relative;
                            z-index: 1;
                        }
                        .content {
                            padding: 50px;
                        }
                        .welcome-text {
                            font-size: 24px;
                            color: #00ff9d;
                            margin-bottom: 30px;
                            text-align: center;
                            font-weight: 600;
                        }
                        .code-container {
                            background: rgba(0, 0, 0, 0.5);
                            border: 2px solid #00ff9d;
                            border-radius: 15px;
                            padding: 40px;
                            text-align: center;
                            margin: 40px 0;
                            position: relative;
                            overflow: hidden;
                        }
                        .code-container::before {
                            content: '';
                            position: absolute;
                            top: 0;
                            left: -100%;
                            width: 100%;
                            height: 100%;
                            background: linear-gradient(90deg, transparent, rgba(0, 255, 157, 0.1), transparent);
                            animation: shine 3s infinite;
                        }
                        .verification-code {
                            font-family: 'Courier New', monospace;
                            font-size: 60px;
                            font-weight: 900;
                            letter-spacing: 20px;
                            color: #00ff9d;
                            text-shadow: 0 0 20px rgba(0, 255, 157, 0.5);
                            margin: 0;
                            animation: pulse 2s infinite;
                        }
                        .instructions {
                            color: rgba(255, 255, 255, 0.8);
                            line-height: 1.8;
                            font-size: 16px;
                            text-align: center;
                            margin: 30px 0;
                        }
                        .warning-box {
                            background: rgba(255, 62, 128, 0.1);
                            border: 1px solid rgba(255, 62, 128, 0.3);
                            border-radius: 10px;
                            padding: 20px;
                            margin: 30px 0;
                            text-align: center;
                        }
                        .warning-box strong {
                            color: #ff3e80;
                        }
                        .steps {
                            background: rgba(0, 255, 157, 0.05);
                            border-radius: 10px;
                            padding: 20px;
                            margin: 30px 0;
                        }
                        .step {
                            display: flex;
                            align-items: center;
                            margin: 15px 0;
                            color: rgba(255, 255, 255, 0.7);
                        }
                        .step-number {
                            background: #00ff9d;
                            color: #0a0a0a;
                            width: 30px;
                            height: 30px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-weight: bold;
                            margin-right: 15px;
                        }
                        .footer {
                            background: rgba(0, 0, 0, 0.7);
                            padding: 30px;
                            text-align: center;
                            border-top: 1px solid rgba(255, 255, 255, 0.1);
                            color: rgba(255, 255, 255, 0.5);
                            font-size: 14px;
                        }
                        @keyframes pulse {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.8; }
                        }
                        @keyframes shine {
                            0% { left: -100%; }
                            100% { left: 100%; }
                        }
                        @keyframes gridMove {
                            0% { transform: translate(0, 0); }
                            100% { transform: translate(20px, 20px); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>CROMWELL PAY</h1>
                            <p>Sistema de Recargas USDT y Saldo Móvil</p>
                        </div>
                        
                        <div class="content">
                            <div class="welcome-text">
                                ¡Bienvenido a la Revolución de las Recargas!
                            </div>
                            
                            <div class="instructions">
                                Hola, gracias por registrarte en Cromwell Pay. Para activar tu cuenta y acceder a todas las funciones, por favor utiliza el siguiente código de verificación:
                            </div>
                            
                            <div class="code-container">
                                <p class="verification-code">${code}</p>
                            </div>
                            
                            <div class="warning-box">
                                <strong>⚠️ ATENCIÓN:</strong> Este código es válido por <strong>15 minutos</strong> y solo puede ser usado una vez.
                            </div>
                            
                            <div class="steps">
                                <div class="step">
                                    <div class="step-number">1</div>
                                    <div>Ingresa el código en la página de verificación de Cromwell Pay</div>
                                </div>
                                <div class="step">
                                    <div class="step-number">2</div>
                                    <div>Tu cuenta será activada inmediatamente</div>
                                </div>
                                <div class="step">
                                    <div class="step-number">3</div>
                                    <div>Comienza a recargar y ganar tokens CWT y CWS</div>
                                </div>
                            </div>
                            
                            <div class="instructions">
                                Si no solicitaste este código, por favor ignora este mensaje.<br>
                                Para cualquier duda, contacta a nuestro soporte.
                            </div>
                        </div>
                        
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} Cromwell Pay. Todos los derechos reservados.</p>
                            <p>Este es un mensaje automático, por favor no responder directamente a este correo.</p>
                            <p>🔒 Tus datos están protegidos con encriptación de nivel bancario</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `Tu código de verificación para Cromwell Pay es: ${code}. Ingresa este código en la página de verificación para activar tu cuenta. El código expira en 15 minutos. Si no solicitaste este código, ignora este mensaje.`
        };

        const { data, error } = await resendClient.emails.send(emailData);

        if (error) {
            console.error('❌ Error enviando email con Resend:', error);
            throw error;
        }

        console.log(`✅ Email enviado exitosamente a: ${email}`);
        console.log(`📧 ID del email: ${data.id}`);
        
        return { 
            success: true, 
            mode: 'email', 
            code: code,
            message: 'Email enviado exitosamente'
        };

    } catch (error) {
        console.error('❌ Error crítico enviando email:', error.message);
        console.log(`📧 [MODO SEGURO] Código para ${email}: ${code}`);
        
        return { 
            success: true, 
            mode: 'console', 
            code: code,
            message: 'Email no enviado. Código disponible en consola.'
        };
    }
}

// ============================================
// RUTAS API (VERSIÓN SIMPLIFICADA Y ROBUSTA)
// ============================================

// 1. REGISTRO CON RESEND
app.post('/api/register', async (req, res) => {
    console.log('📝 Registro:', req.body.email);
    
    try {
        const { email, password, termsAccepted } = req.body;

        if (!email || !password) {
            return res.json({ 
                success: false, 
                message: 'Email y contraseña requeridos' 
            });
        }

        if (!termsAccepted) {
            return res.json({ 
                success: false, 
                message: 'Debes aceptar los términos y condiciones' 
            });
        }

        if (password.length < 6) {
            return res.json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.json({ 
                success: false, 
                message: 'Email no válido' 
            });
        }

        const emailLower = email.toLowerCase();

        // Verificar si existe
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', emailLower)
            .single();

        if (existingUser) {
            return res.json({ 
                success: false, 
                message: 'Este email ya está registrado' 
            });
        }

        // Crear usuario
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateUserId();
        
        const newUser = {
            user_id: userId,
            email: emailLower,
            password_hash: hashedPassword,
            verified: false,
            role: 'user',
            cwt: 0,
            cws: 0,
            accepted_terms: true
        };

        const { error: insertError } = await supabase
            .from('users')
            .insert([newUser]);

        if (insertError) {
            console.error('❌ Error creando usuario:', insertError);
            return res.json({ 
                success: false, 
                message: 'Error al crear usuario' 
            });
        }

        // Generar código
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        
        // Guardar código
        await supabase
            .from('verification_codes')
            .insert([{
                email: emailLower,
                code: verificationCode,
                expires_at: expiresAt.toISOString()
            }]);

        // Enviar email CON RESEND
        const emailResult = await sendVerificationEmail(email, verificationCode);
        
        let message = 'Registro exitoso. ';
        let responseData = {
            success: true,
            message: '',
            email: email,
            userId: userId
        };

        if (emailResult.mode === 'email') {
            message += 'Revisa tu correo para el código de verificación.';
            responseData.message = message;
            responseData.emailSent = true;
        } else {
            message += `Código de verificación: ${verificationCode}`;
            responseData.message = message;
            responseData.emailSent = false;
            responseData.verificationCode = verificationCode;
            console.log(`📧 Código para ${email}: ${verificationCode}`);
        }

        res.json(responseData);

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 2. LOGIN (igual que antes)
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login:', req.body.email);
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({ 
                success: false, 
                message: 'Email y contraseña requeridos' 
            });
        }

        const emailLower = email.toLowerCase();

        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', emailLower)
            .single();

        if (!user) {
            return res.json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }

        if (!user.verified) {
            return res.json({ 
                success: false, 
                message: 'Email no verificado. Verifica tu cuenta primero.',
                needsVerification: true,
                email: user.email,
                userId: user.user_id
            });
        }

        const token = jwt.sign(
            { 
                id: user.id,
                user_id: user.user_id,
                email: user.email, 
                role: user.role || 'user',
                verified: user.verified 
            },
            process.env.JWT_SECRET || 'cromwell-secret-key-2024',
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
        console.error('❌ Error en login:', error);
        res.json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. VERIFICACIÓN
app.post('/api/verify', async (req, res) => {
    console.log('🔐 Verificación:', req.body.email);
    
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.json({ 
                success: false, 
                message: 'Email y código requeridos' 
            });
        }

        const emailLower = email.toLowerCase();
        const now = new Date().toISOString();

        const { data: verification } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', emailLower)
            .eq('code', code)
            .gt('expires_at', now)
            .single();

        if (!verification) {
            return res.json({ 
                success: false, 
                message: 'Código inválido o expirado' 
            });
        }

        const { data: user } = await supabase
            .from('users')
            .update({ verified: true })
            .eq('email', emailLower)
            .select('*')
            .single();

        await supabase
            .from('verification_codes')
            .delete()
            .eq('id', verification.id);

        const token = jwt.sign(
            { 
                id: user.id,
                user_id: user.user_id,
                email: user.email, 
                role: user.role || 'user',
                verified: true 
            },
            process.env.JWT_SECRET || 'cromwell-secret-key-2024',
            { expiresIn: '7d' }
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
        res.json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 4. REENVIAR CÓDIGO
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.json({ 
                success: false, 
                message: 'Email requerido' 
            });
        }

        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await supabase
            .from('verification_codes')
            .delete()
            .eq('email', email.toLowerCase());

        await supabase
            .from('verification_codes')
            .insert([{
                email: email.toLowerCase(),
                code: verificationCode,
                expires_at: expiresAt.toISOString()
            }]);

        const emailResult = await sendVerificationEmail(email, verificationCode);
        
        let message = 'Código reenviado. ';
        if (emailResult.mode === 'email') {
            message += 'Revisa tu correo.';
        } else {
            message += `Código: ${verificationCode}`;
        }

        res.json({ 
            success: true, 
            message: message,
            verificationCode: verificationCode
        });

    } catch (error) {
        console.error('❌ Error reenviar código:', error);
        res.json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. VERIFICAR TOKEN
app.post('/api/verify-token', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ 
            success: false, 
            message: 'Token no proporcionado' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'cromwell-secret-key-2024', (err, user) => {
        if (err) {
            return res.json({ 
                success: false, 
                message: 'Token inválido o expirado' 
            });
        }
        res.json({ 
            success: true, 
            user 
        });
    });
});

// 6. ESTADO
app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        status: 'online',
        timestamp: new Date().toLocaleString(),
        emailService: emailConfigured ? 'Resend (Gmail) activo' : 'Modo consola'
    });
});

// ============================================
// RUTAS WEB
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================
// CREAR ADMIN
// ============================================
async function createAdminIfNotExists() {
    try {
        const adminEmail = 'cromwellpayclient@gmail.com';
        
        const { data: admin } = await supabase
            .from('users')
            .select('*')
            .eq('email', adminEmail)
            .single();
            
        if (admin) {
            console.log('✅ Admin ya existe');
            return;
        }
        
        const hashedPassword = await bcrypt.hash('V3ry$tr0ngP@$$w0rd_2024@Admin', 10);
        
        await supabase.from('users').insert([{
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
        
        console.log('✅ Admin creado');
        
    } catch (error) {
        console.error('⚠️  Error creando admin:', error.message);
    }
}

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, async () => {
    console.log('========================================');
    console.log(`🚀 SERVIDOR INICIADO EN PUERTO ${PORT}`);
    console.log('========================================');
    
    await createAdminIfNotExists();
    
    if (emailConfigured) {
        console.log('✅ EMAIL: CONFIGURADO CON RESEND');
        console.log('📧 Remitente:', process.env.FROM_EMAIL);
        console.log('📧 Servicio: Gmail via Resend');
        console.log('📧 Estado: 100% funcional desde Cuba');
    } else {
        console.log('⚠️  EMAIL: MODO CONSOLA');
        console.log('💡 Para activar emails:');
        console.log('1. Regístrate en https://resend.com');
        console.log('2. Crea API Key');
        console.log('3. Agrega variables en Render:');
        console.log('   - RESEND_API_KEY=re_xxxxxx');
        console.log('   - FROM_EMAIL=tu_email@gmail.com');
    }
    
    console.log('✅ Sistema listo');
    console.log('========================================');
});
