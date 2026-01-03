const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIGURACIÓN ==========
app.use(cors());
app.use(express.json());

// IMPORTANTE: Servir archivos estáticos desde la carpeta 'public'
app.use(express.static('public'));

// También servir archivos desde la raíz (para compatibilidad)
app.use(express.static('.'));

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// JWT
const JWT_SECRET = process.env.JWT_SECRET;

// Nodemailer - GMAIL
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ========== FUNCIONES AUXILIARES ==========
// (Mantén todas las funciones auxiliares igual)

function validarEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function generarCodigoVerificacion() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Middleware: Autenticación JWT
const autenticarToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token de acceso requerido' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('id', decoded.userId)
            .single();
        
        if (error || !usuario) {
            return res.status(401).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        req.user = usuario;
        next();
    } catch (error) {
        return res.status(403).json({ 
            success: false, 
            message: 'Token inválido o expirado' 
        });
    }
};

// ========== RUTAS PÚBLICAS ==========

// 1. Estado del servidor
app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        status: '✅ Servidor Cromwell Pay funcionando correctamente',
        timestamp: new Date().toISOString(),
        emailConfig: transporter ? 'Configurado' : 'No configurado',
        environment: process.env.NODE_ENV || 'development'
    });
});

// 2. Registrar usuario
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, termsAccepted } = req.body;
        
        // Validaciones
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        if (!validarEmail(email)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Formato de email inválido' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }
        
        if (!termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes aceptar los términos y condiciones' 
            });
        }
        
        // Verificar si el usuario ya existe
        const { data: usuarioExistente } = await supabase
            .from('usuarios')
            .select('id')
            .eq('email', email.toLowerCase())
            .single();
        
        if (usuarioExistente) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está registrado' 
            });
        }
        
        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generar ID de usuario
        const userId = 'CROM-' + Date.now().toString().slice(-6);
        
        // Generar código de verificación
        const codigoVerificacion = generarCodigoVerificacion();
        const expiracionVerificacion = new Date(Date.now() + 15 * 60 * 1000);
        
        // Crear usuario
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .insert([{
                email: email.toLowerCase(),
                password: hashedPassword,
                user_id: userId,
                nickname: email.split('@')[0],
                cwt: 0,
                cws: 0,
                role: 'user',
                verified: false,
                verification_code: codigoVerificacion,
                verification_expires: expiracionVerificacion.toISOString(),
                created_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) {
            console.error('❌ Error al crear usuario:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear usuario' 
            });
        }
        
        // Enviar correo de verificación
        try {
            const opcionesCorreo = {
                from: `"Cromwell Pay" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Código de Verificación - Cromwell Pay',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: #0a0a0a; color: #00ff9d; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; border: 1px solid #00ff9d;">
                            <h1 style="margin: 0; font-size: 24px;">CROMWELL PAY</h1>
                            <p style="margin: 5px 0 0 0; font-size: 14px;">Sistema de Recargas USDT y Saldo Móvil</p>
                        </div>
                        <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 10px 10px; color: #ffffff; border: 1px solid #333; border-top: none;">
                            <h2 style="color: #00ff9d; margin-top: 0;">VERIFICACIÓN DE CUENTA</h2>
                            <p>Estimado usuario,</p>
                            <p>Gracias por registrarte en <strong>Cromwell Pay</strong>. Para activar tu cuenta, utiliza el siguiente código de verificación:</p>
                            
                            <div style="background: rgba(0, 255, 157, 0.1); border: 2px solid #00ff9d; border-radius: 8px; padding: 25px; text-align: center; margin: 25px 0;">
                                <div style="font-size: 42px; font-weight: bold; color: #00ff9d; letter-spacing: 10px; font-family: 'Courier New', monospace; margin: 10px 0;">
                                    ${codigoVerificacion}
                                </div>
                                <p style="color: #aaaaaa; margin-top: 10px; font-size: 14px;">
                                    ⏰ Este código expira en 15 minutos
                                </p>
                            </div>
                            
                            <p>Ingresa este código en la ventana de verificación para completar tu registro.</p>
                            
                            <div style="margin-top: 30px; padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border-left: 4px solid #ff3e80;">
                                <p style="margin: 0; font-size: 14px; color: #ff3e80;">
                                    <strong>IMPORTANTE:</strong> No compartas este código con nadie. El equipo de Cromwell Pay nunca te pedirá tu código de verificación.
                                </p>
                            </div>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; color: #888888; font-size: 12px;">
                                <p>© ${new Date().getFullYear()} Cromwell Pay. Todos los derechos reservados.</p>
                                <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
                            </div>
                        </div>
                    </div>
                `
            };
            
            await transporter.sendMail(opcionesCorreo);
            console.log(`✅ Correo de verificación enviado a: ${email}`);
            
        } catch (emailError) {
            console.error('❌ Error al enviar correo:', emailError);
        }
        
        res.json({
            success: true,
            message: 'Registro exitoso. Revisa tu correo electrónico para obtener el código de verificación.',
            userId: usuario.id,
            email: usuario.email,
            user_id: usuario.user_id
        });
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. Reenviar código de verificación
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email es requerido' 
            });
        }
        
        // Buscar usuario
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();
        
        if (error || !usuario) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        if (usuario.verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'El usuario ya está verificado' 
            });
        }
        
        // Generar nuevo código
        const nuevoCodigo = generarCodigoVerificacion();
        const nuevaExpiracion = new Date(Date.now() + 15 * 60 * 1000);
        
        // Actualizar código
        const { error: updateError } = await supabase
            .from('usuarios')
            .update({
                verification_code: nuevoCodigo,
                verification_expires: nuevaExpiracion.toISOString()
            })
            .eq('id', usuario.id);
        
        if (updateError) {
            throw updateError;
        }
        
        // Enviar nuevo correo
        try {
            const opcionesCorreo = {
                from: `"Cromwell Pay" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Nuevo Código de Verificación - Cromwell Pay',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: #0a0a0a; color: #00ff9d; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; border: 1px solid #00ff9d;">
                            <h1 style="margin: 0; font-size: 24px;">CROMWELL PAY</h1>
                            <p style="margin: 5px 0 0 0; font-size: 14px;">Sistema de Recargas USDT y Saldo Móvil</p>
                        </div>
                        <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 10px 10px; color: #ffffff; border: 1px solid #333; border-top: none;">
                            <h2 style="color: #00ff9d; margin-top: 0;">NUEVO CÓDIGO DE VERIFICACIÓN</h2>
                            <p>Hola,</p>
                            <p>Has solicitado un nuevo código de verificación para tu cuenta en Cromwell Pay:</p>
                            
                            <div style="background: rgba(0, 255, 157, 0.1); border: 2px solid #00ff9d; border-radius: 8px; padding: 25px; text-align: center; margin: 25px 0;">
                                <div style="font-size: 42px; font-weight: bold; color: #00ff9d; letter-spacing: 10px; font-family: 'Courier New', monospace; margin: 10px 0;">
                                    ${nuevoCodigo}
                                </div>
                                <p style="color: #aaaaaa; margin-top: 10px; font-size: 14px;">
                                    ⏰ Este código expira en 15 minutos
                                </p>
                            </div>
                            
                            <p>Ingresa este código en la ventana de verificación para completar tu registro.</p>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; color: #888888; font-size: 12px;">
                                <p>© ${new Date().getFullYear()} Cromwell Pay. Todos los derechos reservados.</p>
                            </div>
                        </div>
                    </div>
                `
            };
            
            await transporter.sendMail(opcionesCorreo);
            console.log(`✅ Nuevo código enviado a: ${email}`);
            
        } catch (emailError) {
            console.error('❌ Error al reenviar correo:', emailError);
        }
        
        res.json({
            success: true,
            message: 'Se ha enviado un nuevo código de verificación a tu email.'
        });
        
    } catch (error) {
        console.error('❌ Error al reenviar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 4. Verificar email con código
app.post('/api/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y código son requeridos' 
            });
        }
        
        // Validar formato del código
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ 
                success: false, 
                message: 'El código debe tener 6 dígitos numéricos' 
            });
        }
        
        // Buscar usuario
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();
        
        if (error || !usuario) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        if (usuario.verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'El usuario ya está verificado' 
            });
        }
        
        // Verificar código
        if (usuario.verification_code !== code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código de verificación incorrecto' 
            });
        }
        
        // Verificar expiración
        const ahora = new Date();
        const expiracion = new Date(usuario.verification_expires);
        
        if (ahora > expiracion) {
            return res.status(400).json({ 
                success: false, 
                message: 'El código de verificación ha expirado' 
            });
        }
        
        // Marcar como verificado
        const { error: updateError } = await supabase
            .from('usuarios')
            .update({
                verified: true,
                verification_code: null,
                verification_expires: null
            })
            .eq('id', usuario.id);
        
        if (updateError) {
            throw updateError;
        }
        
        // Generar token JWT
        const token = jwt.sign(
            { 
                userId: usuario.id, 
                email: usuario.email,
                role: usuario.role 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // Crear notificación de bienvenida
        await supabase
            .from('notificaciones')
            .insert([{
                user_id: usuario.id,
                title: '¡Bienvenido a Cromwell Pay!',
                message: 'Tu cuenta ha sido verificada exitosamente. Ya puedes comenzar a usar todos los servicios.',
                type: 'system',
                read: false,
                created_at: new Date().toISOString()
            }]);
        
        res.json({
            success: true,
            message: '¡Email verificado exitosamente!',
            token,
            user: {
                id: usuario.id,
                email: usuario.email,
                user_id: usuario.user_id,
                nickname: usuario.nickname,
                role: usuario.role,
                verified: true,
                cwt: usuario.cwt,
                cws: usuario.cws
            }
        });
        
    } catch (error) {
        console.error('❌ Error en verificación:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. Iniciar sesión
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        // Buscar usuario
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();
        
        if (error || !usuario) {
            return res.status(401).json({ 
                success: false, 
                message: 'Email o contraseña incorrectos' 
            });
        }
        
        // Verificar contraseña
        const passwordValida = await bcrypt.compare(password, usuario.password);
        
        if (!passwordValida) {
            return res.status(401).json({ 
                success: false, 
                message: 'Email o contraseña incorrectos' 
            });
        }
        
        // Verificar si el email está verificado
        if (!usuario.verified) {
            return res.json({
                success: false,
                needsVerification: true,
                message: 'Por favor verifica tu email para iniciar sesión',
                email: usuario.email,
                userId: usuario.id
            });
        }
        
        // Generar token JWT
        const token = jwt.sign(
            { 
                userId: usuario.id, 
                email: usuario.email,
                role: usuario.role 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token,
            user: {
                id: usuario.id,
                email: usuario.email,
                user_id: usuario.user_id,
                nickname: usuario.nickname,
                role: usuario.role,
                verified: usuario.verified,
                cwt: usuario.cwt || 0,
                cws: usuario.cws || 0,
                phone: usuario.phone,
                province: usuario.province,
                wallet: usuario.wallet,
                notifications: usuario.notifications
            }
        });
        
    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 6. Verificar token
app.get('/api/verify-token', autenticarToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// 7. Dashboard del usuario
app.get('/api/dashboard', autenticarToken, async (req, res) => {
    try {
        res.json({
            success: true,
            user: {
                id: req.user.id,
                email: req.user.email,
                user_id: req.user.user_id,
                nickname: req.user.nickname,
                role: req.user.role,
                verified: req.user.verified,
                cwt: req.user.cwt || 0,
                cws: req.user.cws || 0,
                phone: req.user.phone,
                province: req.user.province,
                wallet: req.user.wallet,
                notifications: req.user.notifications
            }
        });
    } catch (error) {
        console.error('❌ Error al cargar dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA ARCHIVOS HTML ==========

// IMPORTANTE: Rutas explícitas para los archivos HTML
app.get('/', (req, res) => {
    // Intenta primero desde 'public'
    try {
        res.sendFile(__dirname + '/public/login.html');
    } catch (error) {
        // Si falla, intenta desde la raíz
        try {
            res.sendFile(__dirname + '/login.html');
        } catch {
            res.status(404).send('Archivo login.html no encontrado');
        }
    }
});

app.get('/login.html', (req, res) => {
    try {
        res.sendFile(__dirname + '/public/login.html');
    } catch {
        try {
            res.sendFile(__dirname + '/login.html');
        } catch {
            res.status(404).send('Archivo no encontrado');
        }
    }
});

app.get('/dashboard.html', (req, res) => {
    try {
        res.sendFile(__dirname + '/public/dashboard.html');
    } catch {
        try {
            res.sendFile(__dirname + '/dashboard.html');
        } catch {
            res.status(404).send('Archivo no encontrado');
        }
    }
});

// Ruta catch-all para SPA
app.get('*', (req, res) => {
    // Si es una ruta de API, devolver 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            message: 'Ruta API no encontrada' 
        });
    }
    
    // Para cualquier otra ruta, servir login.html
    try {
        res.sendFile(__dirname + '/public/login.html');
    } catch {
        try {
            res.sendFile(__dirname + '/login.html');
        } catch {
            res.status(404).send('Archivo no encontrado');
        }
    }
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log(`🚀 Servidor Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`📁 Directorio actual: ${__dirname}`);
    console.log(`📧 Correo configurado: ${process.env.EMAIL_USER || 'No configurado'}`);
    console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? 'Configurado' : 'No configurado'}`);
    console.log(`🗄️  Supabase: ${supabaseUrl ? 'Conectado' : 'No configurado'}`);
    
    // Verificar que los archivos existan
    const fs = require('fs');
    const path = require('path');
    
    const filesToCheck = [
        { name: 'login.html', path: path.join(__dirname, 'public/login.html') },
        { name: 'login.html (raíz)', path: path.join(__dirname, 'login.html') },
        { name: 'dashboard.html', path: path.join(__dirname, 'public/dashboard.html') },
        { name: 'dashboard.html (raíz)', path: path.join(__dirname, 'dashboard.html') }
    ];
    
    console.log('\n📋 Verificación de archivos:');
    filesToCheck.forEach(file => {
        const exists = fs.existsSync(file.path);
        console.log(`   ${exists ? '✅' : '❌'} ${file.name}: ${exists ? 'ENCONTRADO' : 'NO ENCONTRADO'}`);
    });
});
