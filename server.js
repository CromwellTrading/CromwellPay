const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configuración de JWT
const JWT_SECRET = process.env.JWT_SECRET || 'cromwell_pay_secret_key_production_2024';
const JWT_EXPIRES_IN = '7d';

// Configuración de Nodemailer (Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'cromwellpay@gmail.com',
        pass: process.env.EMAIL_PASS || 'tu_contraseña_de_aplicacion'
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
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
    const mailOptions = {
        from: '"Cromwell Pay" <cromwellpay@gmail.com>',
        to: email,
        subject: 'Código de Verificación - Cromwell Pay',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #fff; padding: 30px; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #00ff9d; font-family: 'Orbitron', sans-serif; font-size: 28px;">
                        <i class="fas fa-coins"></i> CROMWELL PAY
                    </h1>
                    <p style="color: rgba(255,255,255,0.7); font-size: 14px;">Sistema de Recargas USDT y Saldo Móvil</p>
                </div>
                
                <div style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 10px; margin: 25px 0;">
                    <h2 style="color: #00ff9d; text-align: center; margin-bottom: 20px;">¡Bienvenido a Cromwell Pay!</h2>
                    <p style="color: rgba(255,255,255,0.8); line-height: 1.6;">
                        Gracias por registrarte en nuestro sistema. Para completar tu registro y comenzar a usar nuestros servicios, 
                        por favor verifica tu dirección de correo electrónico utilizando el siguiente código:
                    </p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <div style="display: inline-block; background: rgba(0,255,157,0.1); border: 2px solid #00ff9d; border-radius: 10px; padding: 20px;">
                            <div style="font-family: 'Courier New', monospace; font-size: 32px; letter-spacing: 10px; color: #00ff9d; font-weight: bold;">
                                ${code}
                            </div>
                        </div>
                    </div>
                    
                    <p style="color: rgba(255,255,255,0.7); font-size: 12px; text-align: center;">
                        Este código expirará en 15 minutos. Si no lo solicitaste, puedes ignorar este mensaje.
                    </p>
                </div>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <p style="color: rgba(255,255,255,0.5); font-size: 12px; text-align: center;">
                        <i class="fas fa-shield-alt"></i> Sistema seguro de recargas con tokens CWT y CWS<br>
                        © 2024 Cromwell Pay. Todos los derechos reservados.
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error al enviar correo:', error);
        return false;
    }
}

async function sendNotificationEmail(email, title, message) {
    const mailOptions = {
        from: '"Cromwell Pay" <cromwellpay@gmail.com>',
        to: email,
        subject: title,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #fff; padding: 30px; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #00ff9d; font-family: 'Orbitron', sans-serif; font-size: 24px;">
                        <i class="fas fa-bell"></i> ${title}
                    </h1>
                </div>
                
                <div style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 10px; margin: 25px 0;">
                    <p style="color: rgba(255,255,255,0.8); line-height: 1.6; font-size: 16px;">
                        ${message}
                    </p>
                </div>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <p style="color: rgba(255,255,255,0.5); font-size: 12px; text-align: center;">
                        <i class="fas fa-shield-alt"></i> Sistema Cromwell Pay<br>
                        © 2024 Cromwell Pay. Todos los derechos reservados.
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error al enviar notificación por email:', error);
        return false;
    }
}

// ============================================
// ENDPOINTS DE AUTENTICACIÓN
// ============================================

// 1. Registro de usuario
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, termsAccepted } = req.body;

        // Validaciones
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });
        }

        if (!termsAccepted) {
            return res.status(400).json({ success: false, message: 'Debes aceptar los términos y condiciones' });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Email no válido' });
        }

        // Validar longitud de contraseña
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar si el usuario ya existe en Supabase
        const { data: existingUser, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Este email ya está registrado' });
        }

        // Hashear contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Crear usuario en Supabase
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
            last_activity: new Date().toISOString(),
            joined_at: new Date().toISOString(),
            accepted_terms: true
        };

        const { data: createdUser, error: createError } = await supabase
            .from('users')
            .insert([newUser])
            .select()
            .single();

        if (createError) {
            console.error('Error al crear usuario:', createError);
            return res.status(500).json({ success: false, message: 'Error al crear el usuario' });
        }

        // Generar código de verificación
        const verificationCode = generateVerificationCode();
        
        // Guardar código en Supabase
        const verificationData = {
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        };

        const { error: codeError } = await supabase
            .from('verification_codes')
            .insert([verificationData]);

        if (codeError) {
            console.error('Error al guardar código:', codeError);
            await supabase.from('users').delete().eq('email', email.toLowerCase());
            return res.status(500).json({ success: false, message: 'Error al generar código de verificación' });
        }

        // Enviar correo de verificación
        const emailSent = await sendVerificationEmail(email, verificationCode);
        
        if (!emailSent) {
            await supabase.from('users').delete().eq('email', email.toLowerCase());
            await supabase.from('verification_codes').delete().eq('email', email.toLowerCase());
            return res.status(500).json({ success: false, message: 'Error al enviar el correo de verificación' });
        }

        res.json({ 
            success: true, 
            message: 'Registro exitoso. Se ha enviado un código de verificación a tu email.' 
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 2. Verificación de email
app.post('/api/verify', async (req, res) => {
    try {
        const { email, code } = req.body;

        // Validaciones
        if (!email || !code) {
            return res.status(400).json({ success: false, message: 'Email y código son requeridos' });
        }

        // Buscar usuario en Supabase
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        // Verificar si ya está verificado
        if (user.verified) {
            return res.json({ success: true, message: 'El usuario ya está verificado' });
        }

        // Verificar intentos de verificación
        if (user.verification_attempts >= 5) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados intentos fallidos. Intenta nuevamente más tarde.' 
            });
        }

        // Buscar código de verificación
        const { data: verification, error: codeError } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .single();

        if (!verification) {
            // Incrementar intentos fallidos
            await supabase
                .from('users')
                .update({ 
                    verification_attempts: (user.verification_attempts || 0) + 1,
                    last_activity: new Date().toISOString()
                })
                .eq('email', email.toLowerCase());
            
            return res.status(400).json({ 
                success: false, 
                message: 'Código de verificación inválido',
                attemptsLeft: 5 - (user.verification_attempts || 0) - 1
            });
        }

        // Verificar expiración
        if (new Date(verification.expires_at) < new Date()) {
            await supabase.from('verification_codes').delete().eq('id', verification.id);
            return res.status(400).json({ success: false, message: 'El código ha expirado' });
        }

        // Marcar usuario como verificado
        const { error: updateError } = await supabase
            .from('users')
            .update({ 
                verified: true,
                verification_attempts: 0,
                last_activity: new Date().toISOString()
            })
            .eq('email', email.toLowerCase());

        if (updateError) {
            console.error('Error al actualizar usuario:', updateError);
            return res.status(500).json({ success: false, message: 'Error al verificar el usuario' });
        }

        // Eliminar código usado
        await supabase.from('verification_codes').delete().eq('id', verification.id);

        // Generar token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                verified: true 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Preparar respuesta
        const userResponse = { ...user };
        delete userResponse.password_hash;

        res.json({
            success: true,
            message: '¡Email verificado exitosamente!',
            token,
            user: userResponse
        });

    } catch (error) {
        console.error('Error en verificación:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 3. Login de usuario
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, rememberUser } = req.body;

        // Validaciones
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });
        }

        // Buscar usuario en Supabase
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Credenciales incorrectas'
            });
        }

        // Verificar si el email está verificado
        if (!user.verified) {
            return res.status(403).json({ 
                success: false, 
                message: 'Debes verificar tu email antes de iniciar sesión. Revisa tu correo.' 
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

        // Actualizar última actividad
        await supabase
            .from('users')
            .update({ last_activity: new Date().toISOString() })
            .eq('email', email.toLowerCase());

        // Generar token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                verified: user.verified 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Preparar respuesta
        const userResponse = { ...user };
        delete userResponse.password_hash;

        res.json({
            success: true,
            message: 'Login exitoso',
            token,
            user: userResponse
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 4. Reenviar código de verificación
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email es requerido' });
        }

        // Buscar usuario en Supabase
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        // Verificar si ya está verificado
        if (user.verified) {
            return res.json({ success: true, message: 'El usuario ya está verificado' });
        }

        // Eliminar códigos anteriores
        await supabase.from('verification_codes').delete().eq('email', email.toLowerCase());

        // Generar nuevo código
        const verificationCode = generateVerificationCode();
        
        // Guardar código en Supabase
        const verificationData = {
            email: email.toLowerCase(),
            code: verificationCode,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        };

        const { error: codeError } = await supabase
            .from('verification_codes')
            .insert([verificationData]);

        if (codeError) {
            console.error('Error al guardar código:', codeError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al generar código de verificación' 
            });
        }

        // Enviar correo
        const emailSent = await sendVerificationEmail(email, verificationCode);
        
        if (!emailSent) {
            await supabase.from('verification_codes').delete().eq('email', email.toLowerCase());
            return res.status(500).json({ 
                success: false, 
                message: 'Error al enviar el correo de verificación' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Se ha enviado un nuevo código de verificación a tu email.' 
        });

    } catch (error) {
        console.error('Error al reenviar código:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ============================================
// ENDPOINTS DE DASHBOARD
// ============================================

// 5. Dashboard del usuario
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Buscar usuario en Supabase
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        // Preparar respuesta
        const userResponse = { ...user };
        delete userResponse.password_hash;

        res.json({
            success: true,
            user: userResponse,
            dashboardData: {
                totalCWT: user.cwt || 0,
                totalCWS: user.cws || 0,
                stats: {
                    totalRecargas: 0,
                    totalUSDT: 0,
                    totalSaldo: 0
                }
            }
        });

    } catch (error) {
        console.error('Error en dashboard:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 6. Actualizar perfil de usuario
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { nickname, phone, province, wallet, notifications } = req.body;

        // Validar campos obligatorios
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname, teléfono y provincia son obligatorios' 
            });
        }

        // Actualizar usuario en Supabase
        const { data, error } = await supabase
            .from('users')
            .update({
                nickname,
                phone,
                province,
                wallet: wallet || null,
                notifications: notifications !== undefined ? notifications : true,
                last_activity: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error al actualizar perfil:', error);
            return res.status(500).json({ success: false, message: 'Error al actualizar el perfil' });
        }

        const userResponse = { ...data };
        delete userResponse.password_hash;

        res.json({
            success: true,
            message: 'Perfil actualizado exitosamente',
            user: userResponse
        });

    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 7. Verificar token
app.post('/api/verify-token', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.user.id)
            .single();
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const userResponse = { ...user };
        delete userResponse.password_hash;

        res.json({
            success: true,
            user: userResponse
        });

    } catch (error) {
        console.error('Error al verificar token:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ============================================
// ENDPOINTS DE NOTIFICACIONES
// ============================================

// 8. Crear notificación
async function createNotification(userId, title, message, type = 'info') {
    try {
        const notification = {
            user_id: userId,
            title,
            message,
            type,
            read: false
        };

        const { data, error } = await supabase
            .from('notifications')
            .insert([notification])
            .select()
            .single();

        if (error) throw error;

        // Enviar email si el usuario tiene habilitadas las notificaciones
        const { data: user } = await supabase
            .from('users')
            .select('email, notifications')
            .eq('id', userId)
            .single();

        if (user && user.notifications !== false) {
            await sendNotificationEmail(user.email, title, message);
        }

        return notification;
    } catch (error) {
        console.error('Error al crear notificación:', error);
        return null;
    }
}

// 9. Obtener notificaciones del usuario
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            notifications: data || []
        });

    } catch (error) {
        console.error('Error al obtener notificaciones:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 10. Marcar notificación como leída
app.post('/api/notifications/mark-read', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { notificationId } = req.body;

        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId)
            .eq('user_id', userId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Notificación marcada como leída'
        });

    } catch (error) {
        console.error('Error al marcar notificación como leída:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 11. Marcar todas las notificaciones como leídas
app.post('/api/notifications/mark-all-read', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Todas las notificaciones marcadas como leídas'
        });

    } catch (error) {
        console.error('Error al marcar todas las notificaciones como leídas:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 12. Eliminar todas las notificaciones
app.delete('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { error } = await supabase
            .from('notifications')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Todas las notificaciones eliminadas'
        });

    } catch (error) {
        console.error('Error al eliminar notificaciones:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ============================================
// ENDPOINTS DE ADMINISTRACIÓN
// ============================================

// 13. Obtener todos los usuarios (solo admin)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';

        let query = supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (search) {
            query = query.or(`user_id.ilike.%${search}%,email.ilike.%${search}%,nickname.ilike.%${search}%,phone.ilike.%${search}%`);
        }

        const { data: users, error } = await query;

        if (error) throw error;

        // Ocultar contraseñas
        const usersWithoutPasswords = users.map(user => {
            const { password_hash, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });

        res.json({
            success: true,
            users: usersWithoutPasswords
        });

    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 14. Actualizar saldo de usuario (solo admin)
app.put('/api/admin/users/:id/balance', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { cwt, cws, note } = req.body;

        // Validar que no sean negativos
        if (cwt < 0 || cws < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Los valores no pueden ser negativos' 
            });
        }

        // Obtener usuario actual
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        // Calcular diferencias
        const oldCWT = user.cwt || 0;
        const oldCWS = user.cws || 0;
        const cwtDiff = cwt - oldCWT;
        const cwsDiff = cws - oldCWS;

        // Actualizar saldo
        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ 
                cwt,
                cws,
                last_activity: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();

        if (updateError) throw updateError;

        // Registrar transacción
        if (cwtDiff !== 0 || cwsDiff !== 0) {
            const transaction = {
                user_id: userId,
                type: 'admin_adjustment',
                cwt_change: cwtDiff,
                cws_change: cwsDiff,
                note: note || 'Ajuste manual por administrador',
                admin_id: req.user.id
            };

            await supabase.from('transactions').insert([transaction]);

            // Crear notificación para el usuario
            let notificationTitle = '';
            let notificationMessage = '';

            if (cwtDiff > 0 && cwsDiff > 0) {
                notificationTitle = 'Saldo Añadido';
                notificationMessage = `Se añadieron ${cwtDiff.toFixed(2)} CWT y ${cwsDiff} CWS a tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            } else if (cwtDiff > 0) {
                notificationTitle = 'CWT Añadido';
                notificationMessage = `Se añadieron ${cwtDiff.toFixed(2)} CWT a tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            } else if (cwsDiff > 0) {
                notificationTitle = 'CWS Añadido';
                notificationMessage = `Se añadieron ${cwsDiff} CWS a tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            } else if (cwtDiff < 0 && cwsDiff < 0) {
                notificationTitle = 'Saldo Restado';
                notificationMessage = `Se restaron ${Math.abs(cwtDiff).toFixed(2)} CWT y ${Math.abs(cwsDiff)} CWS de tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            } else if (cwtDiff < 0) {
                notificationTitle = 'CWT Restado';
                notificationMessage = `Se restaron ${Math.abs(cwtDiff).toFixed(2)} CWT de tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            } else if (cwsDiff < 0) {
                notificationTitle = 'CWS Restado';
                notificationMessage = `Se restaron ${Math.abs(cwsDiff)} CWS de tu cuenta. ${note ? `Motivo: ${note}` : ''}`;
            }

            if (notificationTitle && notificationMessage) {
                await createNotification(
                    userId, 
                    notificationTitle, 
                    notificationMessage, 
                    cwtDiff >= 0 && cwsDiff >= 0 ? 'success' : 'warning'
                );
            }
        }

        const userResponse = { ...updatedUser };
        delete userResponse.password_hash;

        res.json({
            success: true,
            message: 'Saldo actualizado exitosamente',
            user: userResponse
        });

    } catch (error) {
        console.error('Error al actualizar saldo:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 15. Estadísticas del sistema (solo admin)
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Obtener todos los usuarios
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('cwt, cws, verified, role');

        if (usersError) throw usersError;

        // Calcular totales
        const totalCWT = users.reduce((sum, user) => sum + (user.cwt || 0), 0);
        const totalCWS = users.reduce((sum, user) => sum + (user.cws || 0), 0);
        const totalUsers = users.length;
        const verifiedUsers = users.filter(user => user.verified).length;
        const adminUsers = users.filter(user => user.role === 'admin').length;

        // Calcular equivalentes
        const totalUSDT = (totalCWT / 0.1) * 5; // 5 USDT = 0.1 CWT
        const totalSaldo = (totalCWS / 10) * 100; // 100 saldo = 10 CWS

        res.json({
            success: true,
            stats: {
                totalCWT,
                totalCWS,
                totalUsers,
                verifiedUsers,
                adminUsers,
                totalUSDT,
                totalSaldo
            }
        });

    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 16. Inicializar base de datos (crear usuario admin si no existe)
app.post('/api/admin/init-db', async (req, res) => {
    try {
        // Verificar si ya existe el admin
        const { data: existingAdmin, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', 'cromwellpay@gmail.com')
            .single();

        if (existingAdmin) {
            return res.json({ 
                success: true, 
                message: 'Base de datos ya inicializada',
                adminExists: true 
            });
        }

        // Crear usuario admin
        const adminPassword = await bcrypt.hash('admin123', 10);
        const adminUser = {
            user_id: 'CROM-0001',
            email: 'cromwellpay@gmail.com',
            password_hash: adminPassword,
            verified: true,
            role: 'admin',
            cwt: 25.5,
            cws: 1250,
            nickname: 'Administrador',
            phone: '+53 5555 5555',
            province: 'La Habana',
            wallet: '',
            notifications: true,
            last_activity: new Date().toISOString(),
            joined_at: new Date().toISOString(),
            accepted_terms: true
        };

        const { data: createdAdmin, error: createError } = await supabase
            .from('users')
            .insert([adminUser])
            .select()
            .single();

        if (createError) throw createError;

        res.json({ 
            success: true, 
            message: 'Base de datos inicializada exitosamente',
            admin: createdAdmin 
        });

    } catch (error) {
        console.error('Error al inicializar DB:', error);
        res.status(500).json({ success: false, message: 'Error al inicializar la base de datos' });
    }
});

// ============================================
// ENDPOINTS ADICIONALES
// ============================================

// 17. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        // Obtener estadísticas de usuarios
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('*');

        const { data: verifiedCodes, error: codesError } = await supabase
            .from('verification_codes')
            .select('*');

        res.json({
            success: true,
            status: 'online',
            timestamp: new Date().toISOString(),
            usersCount: users?.length || 0,
            verifiedUsers: users?.filter(u => u.verified).length || 0,
            pendingVerifications: verifiedCodes?.length || 0
        });

    } catch (error) {
        console.error('Error en status:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 18. Recuperar contraseña (opcional)
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email es requerido' });
        }

        // Buscar usuario
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            // Por seguridad, no revelamos si el email existe o no
            return res.json({ 
                success: true, 
                message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' 
            });
        }

        // Generar token de recuperación
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hora

        // Guardar token (en producción, guardar en base de datos)
        await supabase
            .from('users')
            .update({ 
                reset_token: resetToken,
                reset_token_expiry: new Date(resetTokenExpiry).toISOString()
            })
            .eq('email', email.toLowerCase());

        // Enviar correo de recuperación
        const resetLink = `http://localhost:3000/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        
        const mailOptions = {
            from: '"Cromwell Pay" <cromwellpay@gmail.com>',
            to: email,
            subject: 'Recuperación de Contraseña - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #00ff9d;">Recuperación de Contraseña</h2>
                    <p>Hemos recibido una solicitud para recuperar tu contraseña.</p>
                    <p>Haz clic en el siguiente enlace para crear una nueva contraseña:</p>
                    <a href="${resetLink}" style="display: inline-block; background: #00ff9d; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0;">
                        Restablecer Contraseña
                    </a>
                    <p>Este enlace expirará en 1 hora.</p>
                    <p>Si no solicitaste recuperar tu contraseña, ignora este mensaje.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.json({ 
            success: true, 
            message: 'Se han enviado instrucciones a tu email para recuperar tu contraseña.' 
        });

    } catch (error) {
        console.error('Error en recuperación de contraseña:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// 19. Resetear contraseña
app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;

        if (!token || !email || !newPassword) {
            return res.status(400).json({ success: false, message: 'Token, email y nueva contraseña son requeridos' });
        }

        // Validar longitud de contraseña
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Buscar usuario con token válido
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('reset_token', token)
            .single();

        if (!user) {
            return res.status(400).json({ success: false, message: 'Token inválido o expirado' });
        }

        // Verificar expiración del token
        if (new Date(user.reset_token_expiry) < new Date()) {
            return res.status(400).json({ success: false, message: 'El token ha expirado' });
        }

        // Hashear nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar contraseña y limpiar token
        const { error: updateError } = await supabase
            .from('users')
            .update({ 
                password_hash: hashedPassword,
                reset_token: null,
                reset_token_expiry: null,
                last_activity: new Date().toISOString()
            })
            .eq('email', email.toLowerCase());

        if (updateError) throw updateError;

        // Enviar notificación por email
        const mailOptions = {
            from: '"Cromwell Pay" <cromwellpay@gmail.com>',
            to: email,
            subject: 'Contraseña Restablecida - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #00ff9d;">Contraseña Restablecida</h2>
                    <p>Tu contraseña ha sido restablecida exitosamente.</p>
                    <p>Si no realizaste este cambio, por favor contacta con soporte inmediatamente.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.json({ 
            success: true, 
            message: 'Contraseña restablecida exitosamente. Ahora puedes iniciar sesión con tu nueva contraseña.' 
        });

    } catch (error) {
        console.error('Error al resetear contraseña:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// Servir archivos estáticos
app.use(express.static('public'));

// Ruta de fallback para SPA
app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Cromwell Pay corriendo en http://localhost:${PORT}`);
    console.log('📊 Configurado con Supabase como base de datos');
});
