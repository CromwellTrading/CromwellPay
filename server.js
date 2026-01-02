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

// Verificar variables críticas
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('🚨 ERROR: Variables de entorno faltantes:', missingVars.join(', '));
    console.error('💡 Asegúrate de crear un archivo .env con las variables necesarias');
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
// CONFIGURACIÓN EMAIL CON GMAIL
// ============================================
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    });
    
    // Verificar conexión del transporte
    transporter.verify(function(error, success) {
        if (error) {
            console.error('❌ Error configuración email:', error.message);
            console.log('⚠️  Usando modo consola para códigos de verificación');
        } else {
            console.log('✅ Email configurado correctamente');
        }
    });
} else {
    console.log('⚠️  Email no configurado - usando consola para códigos');
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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Token requerido' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'cromwell-secret-key-2024', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
};

// Middleware para admin
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Se requiere rol de admin.' });
    }
    next();
};

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
    if (!transporter) {
        console.log(`📧 [MODO CONSOLA] Código para ${email}: ${code}`);
        console.log(`📧 [MODO CONSOLA] El código expira en 15 minutos`);
        return { success: true, mode: 'console' };
    }

    try {
        const mailOptions = {
            from: `"Cromwell Pay" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '✅ Código de Verificación - Cromwell Pay',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #00ff9d, #00cc7a); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
                        <h1 style="color: #0a0a0a; margin: 0; font-size: 24px;">CROMWELL PAY</h1>
                        <p style="color: rgba(0,0,0,0.8); margin: 5px 0 0 0; font-size: 14px;">Sistema de Recargas y Recompensas</p>
                    </div>
                    
                    <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px;">
                        <h2 style="color: #0a0a0a; margin-bottom: 20px;">¡Bienvenido a Cromwell Pay!</h2>
                        <p style="color: #333; font-size: 16px; line-height: 1.5;">
                            Gracias por registrarte. Para activar tu cuenta, por favor utiliza el siguiente código de verificación:
                        </p>
                        
                        <div style="background: linear-gradient(135deg, #f8f9fa, #e9ecef); padding: 25px; border-radius: 10px; text-align: center; margin: 25px 0; border: 2px dashed #00ff9d;">
                            <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #00ff9d; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                ${code}
                            </div>
                        </div>
                        
                        <p style="color: #666; font-size: 14px; line-height: 1.5;">
                            <strong>⚠️ Importante:</strong> Este código es válido por <strong>15 minutos</strong>.<br>
                            Si no solicitaste este código, puedes ignorar este mensaje.
                        </p>
                        
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                            <p style="color: #888; font-size: 12px;">
                                Este es un correo automático, por favor no responder.<br>
                                © ${new Date().getFullYear()} Cromwell Pay. Todos los derechos reservados.
                            </p>
                        </div>
                    </div>
                </div>
            `,
            text: `Tu código de verificación para Cromwell Pay es: ${code}. Este código expira en 15 minutos. Si no solicitaste este código, ignora este mensaje.`
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Email de verificación enviado a: ${email}`);
        return { success: true, mode: 'email' };
    } catch (error) {
        console.error('❌ Error enviando email:', error.message);
        console.log(`📧 [FALLBACK] Código para ${email}: ${code}`);
        return { success: true, mode: 'fallback' };
    }
}

// ============================================
// CREAR ADMIN AL INICIAR
// ============================================
async function createAdminIfNotExists() {
    try {
        const adminEmail = 'cromwellpayclient@gmail.com';
        
        console.log('👤 Verificando administrador...');
        
        // Verificar si existe
        const { data: admin, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('email', adminEmail)
            .single();
            
        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('❌ Error verificando admin:', fetchError.message);
            return;
        }
        
        if (admin) {
            console.log('✅ Admin ya existe:', adminEmail);
            return;
        }
        
        // Crear admin
        console.log('👤 Creando admin...');
        const hashedPassword = await bcrypt.hash('V3ry$tr0ngP@$$w0rd_2024@Admin', 10);
        
        const { error: insertError } = await supabase.from('users').insert([{
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
            accepted_terms: true,
            created_at: new Date().toISOString()
        }]);
        
        if (insertError) {
            console.error('❌ Error creando admin:', insertError.message);
            return;
        }
        
        console.log('========================================');
        console.log('✅ ADMIN CREADO EXITOSAMENTE');
        console.log('📧 Email:', adminEmail);
        console.log('🔑 Contraseña: V3ry$tr0ngP@$$w0rd_2024@Admin');
        console.log('========================================');
        
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

app.get('/dashboard.html', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================
// API ENDPOINTS - AUTENTICACIÓN
// ============================================

// 1. REGISTRO
app.post('/api/register', async (req, res) => {
    console.log('📝 Registro:', req.body.email);
    
    try {
        const { email, password, termsAccepted } = req.body;

        if (!email || !password || !termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Completa todos los campos y acepta los términos' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        // Validar formato email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email no válido' 
            });
        }

        // Verificar si existe
        const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('email')
            .eq('email', email.toLowerCase())
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('❌ Error verificando usuario:', fetchError);
        }

        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Este email ya está registrado' 
            });
        }

        // Crear usuario
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateUserId();
        
        const newUser = {
            user_id: userId,
            email: email.toLowerCase(),
            password_hash: hashedPassword,
            verified: false,
            role: 'user',
            cwt: 0,
            cws: 0,
            accepted_terms: true,
            created_at: new Date().toISOString()
        };

        const { error: insertError } = await supabase
            .from('users')
            .insert([newUser]);

        if (insertError) {
            console.error('❌ Error creando usuario:', insertError);
            
            if (insertError.code === '42501') {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error de permisos en la base de datos' 
                });
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Error al crear usuario' 
            });
        }

        // Generar y guardar código de verificación
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        
        const { error: codeError } = await supabase
            .from('verification_codes')
            .insert([{
                email: email.toLowerCase(),
                code: verificationCode,
                expires_at: expiresAt.toISOString(),
                created_at: new Date().toISOString()
            }]);

        if (codeError) {
            console.error('❌ Error guardando código:', codeError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al generar código de verificación' 
            });
        }

        // Enviar email
        const emailResult = await sendVerificationEmail(email, verificationCode);
        
        let message = 'Registro exitoso. ';
        if (emailResult.mode === 'email') {
            message += 'Revisa tu correo para el código de verificación.';
        } else {
            message += `Código de verificación (consola): ${verificationCode}`;
        }

        res.json({ 
            success: true, 
            message: message,
            email: email,
            userId: userId
        });

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 2. LOGIN
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
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();

        if (userError || !user) {
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

        // Verificar email
        if (!user.verified) {
            // Si no está verificado, devolver un error específico
            return res.status(403).json({ 
                success: false, 
                message: 'Email no verificado. Por favor verifica tu cuenta primero.',
                needsVerification: true,
                email: user.email
            });
        }

        // Generar token JWT
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

        // Remover contraseña del objeto de respuesta
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

        // Buscar código válido
        const { data: verification, error: codeError } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .eq('used', false)
            .single();

        if (codeError || !verification) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código inválido o ya utilizado' 
            });
        }

        // Verificar expiración
        if (new Date(verification.expires_at) < new Date()) {
            // Marcar como usado y eliminar
            await supabase
                .from('verification_codes')
                .update({ used: true })
                .eq('id', verification.id);
            
            return res.status(400).json({ 
                success: false, 
                message: 'Código expirado. Solicita uno nuevo.' 
            });
        }

        // Marcar código como usado
        await supabase
            .from('verification_codes')
            .update({ used: true })
            .eq('id', verification.id);

        // Marcar usuario como verificado
        const { data: user, error: userError } = await supabase
            .from('users')
            .update({ 
                verified: true,
                updated_at: new Date().toISOString()
            })
            .eq('email', email.toLowerCase())
            .select('*')
            .single();

        if (userError || !user) {
            return res.status(500).json({ 
                success: false, 
                message: 'Error al verificar usuario' 
            });
        }

        // Generar token JWT
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

        // Remover contraseña del objeto de respuesta
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
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email requerido' 
            });
        }

        // Verificar si el usuario existe
        const { data: user } = await supabase
            .from('users')
            .select('email, verified')
            .eq('email', email.toLowerCase())
            .single();

        if (!user) {
            return res.status(400).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        if (user.verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'El usuario ya está verificado' 
            });
        }

        // Eliminar códigos anteriores no usados
        await supabase
            .from('verification_codes')
            .update({ used: true })
            .eq('email', email.toLowerCase())
            .eq('used', false);

        // Generar nuevo código
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        
        // Guardar nuevo código
        const { error: insertError } = await supabase
            .from('verification_codes')
            .insert([{
                email: email.toLowerCase(),
                code: verificationCode,
                expires_at: expiresAt.toISOString(),
                created_at: new Date().toISOString()
            }]);

        if (insertError) {
            console.error('❌ Error guardando código:', insertError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al generar código' 
            });
        }

        // Enviar email
        const emailResult = await sendVerificationEmail(email, verificationCode);
        
        let message = 'Código reenviado. ';
        if (emailResult.mode === 'email') {
            message += 'Revisa tu correo.';
        } else {
            message += `Código (consola): ${verificationCode}`;
        }

        res.json({ 
            success: true, 
            message: message 
        });

    } catch (error) {
        console.error('❌ Error reenviar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. VERIFICAR TOKEN
app.post('/api/verify-token', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token no proporcionado' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'cromwell-secret-key-2024', (err, user) => {
        if (err) {
            return res.status(403).json({ 
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

// ============================================
// API ENDPOINTS - DASHBOARD
// ============================================

// 6. OBTENER DATOS DEL DASHBOARD
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Obtener datos del usuario
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        // Remover contraseña
        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error cargando dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al cargar datos del dashboard' 
        });
    }
});

// 7. ACTUALIZAR PERFIL
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

        const updates = {
            nickname,
            phone,
            province,
            wallet: wallet || null,
            notifications: notifications !== false,
            updated_at: new Date().toISOString()
        };

        const { data: user, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', userId)
            .select('*')
            .single();

        if (error) {
            console.error('❌ Error actualizando perfil:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al actualizar perfil' 
            });
        }

        const { password_hash, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Perfil actualizado correctamente',
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('❌ Error actualizando perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ============================================
// API ENDPOINTS - ADMIN
// ============================================

// 8. LISTAR TODOS LOS USUARIOS (Admin)
app.get('/api/admin/users', authenticateToken, adminOnly, async (req, res) => {
    try {
        const search = req.query.search || '';
        
        let query = supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (search) {
            query = query.or(`user_id.ilike.%${search}%,email.ilike.%${search}%,nickname.ilike.%${search}%`);
        }

        const { data: users, error } = await query;

        if (error) {
            console.error('❌ Error obteniendo usuarios:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al obtener usuarios' 
            });
        }

        // Remover contraseñas
        const sanitizedUsers = users.map(user => {
            const { password_hash, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });

        res.json({
            success: true,
            users: sanitizedUsers
        });

    } catch (error) {
        console.error('❌ Error en admin/users:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 9. ACTUALIZAR SALDO DE USUARIO (Admin)
app.put('/api/admin/users/:userId/balance', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { cwt, cws, note } = req.body;

        // Validar valores
        if (cwt < 0 || cws < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Los valores no pueden ser negativos' 
            });
        }

        // Obtener usuario actual
        const { data: currentUser, error: fetchError } = await supabase
            .from('users')
            .select('cwt, cws, email, user_id')
            .eq('id', userId)
            .single();

        if (fetchError || !currentUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }

        // Actualizar saldo
        const { error: updateError } = await supabase
            .from('users')
            .update({
                cwt: parseFloat(cwt),
                cws: parseInt(cws),
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (updateError) {
            console.error('❌ Error actualizando saldo:', updateError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al actualizar saldo' 
            });
        }

        // Registrar la transacción
        const { error: transactionError } = await supabase
            .from('balance_transactions')
            .insert({
                user_id: userId,
                admin_id: req.user.id,
                old_cwt: currentUser.cwt,
                new_cwt: cwt,
                old_cws: currentUser.cws,
                new_cws: cws,
                note: note || 'Ajuste manual por administrador',
                created_at: new Date().toISOString()
            });

        if (transactionError) {
            console.error('❌ Error registrando transacción:', transactionError);
        }

        res.json({
            success: true,
            message: 'Saldo actualizado correctamente'
        });

    } catch (error) {
        console.error('❌ Error actualizando saldo:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 10. ESTADÍSTICAS DEL SISTEMA (Admin)
app.get('/api/admin/stats', authenticateToken, adminOnly, async (req, res) => {
    try {
        // Obtener total de usuarios
        const { count: totalUsers, error: usersError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (usersError) {
            console.error('❌ Error contando usuarios:', usersError);
        }

        // Obtener totales de CWT y CWS
        const { data: balances, error: balancesError } = await supabase
            .from('users')
            .select('cwt, cws');

        let totalCWT = 0;
        let totalCWS = 0;

        if (!balancesError && balances) {
            balances.forEach(user => {
                totalCWT += parseFloat(user.cwt) || 0;
                totalCWS += parseInt(user.cws) || 0;
            });
        }

        // Obtener usuarios activos hoy
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { count: activeToday, error: activeError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('updated_at', today.toISOString());

        res.json({
            success: true,
            stats: {
                totalUsers: totalUsers || 0,
                totalCWT: parseFloat(totalCWT.toFixed(2)),
                totalCWS: totalCWS,
                activeToday: activeToday || 0,
                estimatedUSDT: parseFloat((totalCWT / 0.1 * 5).toFixed(2)),
                estimatedSaldo: Math.round(totalCWS / 10 * 100),
                lastUpdate: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ============================================
// API ENDPOINTS - NOTIFICACIONES
// ============================================

// 11. OBTENER NOTIFICACIONES
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Para simplificar, devolvemos notificaciones dummy
        // En producción, tendrías una tabla de notificaciones
        const notifications = [
            {
                id: 1,
                title: '¡Bienvenido a Cromwell Pay!',
                message: 'Tu cuenta ha sido creada exitosamente. Ahora puedes empezar a recargar y ganar tokens.',
                read: true,
                created_at: new Date().toISOString()
            },
            {
                id: 2,
                title: 'Recuerda verificar tu email',
                message: 'Para acceder a todas las funciones, verifica tu dirección de email.',
                read: false,
                created_at: new Date().toISOString()
            }
        ];

        res.json({
            success: true,
            notifications
        });

    } catch (error) {
        console.error('❌ Error obteniendo notificaciones:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ============================================
// ENDPOINTS AUXILIARES
// ============================================

// 12. ESTADO DEL SERVIDOR
app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 13. OBTENER CONFIGURACIÓN DEL SISTEMA
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: {
            cwtMinimum: 1,
            cwsMinimum: 100,
            cwtRate: 0.1, // 0.1 CWT por cada 5 USDT
            cwsRate: 10, // 10 CWS por cada 100 saldo
            emailConfigured: !!transporter
        }
    });
});

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Ruta no encontrada' 
    });
});

app.use((err, req, res, next) => {
    console.error('🔥 ERROR NO MANEJADO:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Error interno del servidor' 
    });
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
    
    // Verificar conexión a Supabase
    try {
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);
            
        if (error) {
            console.error('⚠️  Advertencia: Error conectando a Supabase:', error.message);
        } else {
            console.log('✅ Conexión a Supabase: OK');
        }
    } catch (error) {
        console.error('⚠️  Advertencia: No se pudo verificar Supabase:', error.message);
    }
    
    console.log('✅ Sistema listo para recibir peticiones');
    console.log('🔗 URL Local: http://localhost:' + PORT);
    console.log('========================================');
});
