const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIGURACIÓN ==========
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.static('.'));

// Supabase Client (con auth)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// JWT Secret para tus propios tokens (opcional)
const JWT_SECRET = process.env.JWT_SECRET || 'supabase-jwt-secret';

// ========== MIDDLEWARE ==========
const verificarUsuarioSupabase = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token requerido' 
        });
    }
    
    try {
        // Verificar token con Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token inválido' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ 
            success: false, 
            message: 'Error de autenticación' 
        });
    }
};

// ========== RUTAS DE AUTH SUPABASE ==========

// 1. Estado del servidor
app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        status: '✅ Cromwell Pay con Supabase Auth',
        auth: 'Supabase Auth activado',
        timestamp: new Date().toISOString()
    });
});

// 2. REGISTRO con Supabase Auth
app.post('/api/register', async (req, res) => {
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
        
        // REGISTRO con Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: email.toLowerCase(),
            password: password,
            options: {
                data: {
                    nickname: email.split('@')[0],
                    user_id: 'CROM-' + Date.now().toString().slice(-6),
                    cwt: 0,
                    cws: 0,
                    role: 'user',
                    phone: '',
                    province: '',
                    wallet: '',
                    notifications: true
                },
                emailRedirectTo: `${req.headers.origin}/dashboard.html`
            }
        });
        
        if (error) {
            console.error('❌ Error en registro Supabase:', error.message);
            
            // Manejar errores comunes
            if (error.message.includes('already registered')) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El email ya está registrado' 
                });
            }
            
            return res.status(400).json({ 
                success: false, 
                message: error.message 
            });
        }
        
        // SUCCESS: Supabase enviará automáticamente el email de verificación
        console.log(`✅ Usuario registrado: ${email}`);
        console.log(`📧 Email de verificación enviado por Supabase`);
        
        res.json({
            success: true,
            message: 'Registro exitoso. Revisa tu email para verificar tu cuenta.',
            user: {
                id: data.user?.id,
                email: data.user?.email,
                user_id: data.user?.user_metadata?.user_id,
                needsVerification: !data.user?.email_confirmed_at
            },
            // Importante: Supabase envía el email automáticamente
            verificationSent: data.user?.email_confirmed_at ? false : true
        });
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. LOGIN con Supabase Auth
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        // LOGIN con Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password: password
        });
        
        if (error) {
            console.error('❌ Error en login:', error.message);
            
            // Verificar si necesita verificación
            if (error.message.includes('Email not confirmed')) {
                return res.json({
                    success: false,
                    needsVerification: true,
                    message: 'Por favor verifica tu email antes de iniciar sesión',
                    email: email
                });
            }
            
            return res.status(401).json({ 
                success: false, 
                message: 'Email o contraseña incorrectos' 
            });
        }
        
        // Verificar si el email está confirmado
        if (!data.user?.email_confirmed_at) {
            return res.json({
                success: false,
                needsVerification: true,
                message: 'Por favor verifica tu email antes de iniciar sesión',
                email: email
            });
        }
        
        // ÉXITO: Usuario verificado y autenticado
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token: data.session?.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                user_id: data.user.user_metadata?.user_id || 'CROM-' + data.user.id.slice(0, 8),
                nickname: data.user.user_metadata?.nickname || email.split('@')[0],
                role: data.user.user_metadata?.role || 'user',
                verified: !!data.user.email_confirmed_at,
                cwt: data.user.user_metadata?.cwt || 0,
                cws: data.user.user_metadata?.cws || 0,
                phone: data.user.user_metadata?.phone || '',
                province: data.user.user_metadata?.province || '',
                wallet: data.user.user_metadata?.wallet || '',
                notifications: data.user.user_metadata?.notifications !== false
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

// 4. REENVIAR email de verificación
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email es requerido' 
            });
        }
        
        // Reenviar email de verificación
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: email.toLowerCase()
        });
        
        if (error) {
            console.error('❌ Error reenviando verificación:', error.message);
            return res.status(400).json({ 
                success: false, 
                message: error.message 
            });
        }
        
        res.json({
            success: true,
            message: 'Email de verificación reenviado. Revisa tu bandeja de entrada.'
        });
        
    } catch (error) {
        console.error('❌ Error al reenviar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. VERIFICAR EMAIL (esta ruta es para cuando el usuario hace clic en el link del email)
app.get('/api/verify', async (req, res) => {
    try {
        // Supabase maneja la verificación automáticamente cuando el usuario hace clic en el link
        // Esta ruta es solo para confirmar
        res.json({
            success: true,
            message: 'Email verificado exitosamente. Ahora puedes iniciar sesión.'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error en verificación' 
        });
    }
});

// 6. VERIFICAR TOKEN
app.get('/api/verify-token', verificarUsuarioSupabase, async (req, res) => {
    try {
        // Obtener metadata del usuario
        const { data: { user } } = await supabase.auth.getUser(req.user.id);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                user_id: user.user_metadata?.user_id || 'CROM-' + user.id.slice(0, 8),
                nickname: user.user_metadata?.nickname || user.email.split('@')[0],
                role: user.user_metadata?.role || 'user',
                verified: !!user.email_confirmed_at,
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0,
                phone: user.user_metadata?.phone || '',
                province: user.user_metadata?.province || '',
                wallet: user.user_metadata?.wallet || '',
                notifications: user.user_metadata?.notifications !== false
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Error al verificar token' 
        });
    }
});

// 7. DASHBOARD - Obtener datos del usuario
app.get('/api/dashboard', verificarUsuarioSupabase, async (req, res) => {
    try {
        const { data: { user } } = await supabase.auth.getUser(req.user.id);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                user_id: user.user_metadata?.user_id || 'CROM-' + user.id.slice(0, 8),
                nickname: user.user_metadata?.nickname || user.email.split('@')[0],
                role: user.user_metadata?.role || 'user',
                verified: !!user.email_confirmed_at,
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0,
                phone: user.user_metadata?.phone || '',
                province: user.user_metadata?.province || '',
                wallet: user.user_metadata?.wallet || '',
                notifications: user.user_metadata?.notifications !== false
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

// 8. ACTUALIZAR PERFIL del usuario
app.put('/api/user/profile', verificarUsuarioSupabase, async (req, res) => {
    try {
        const { nickname, phone, province, wallet, notifications } = req.body;
        
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname, teléfono y provincia son requeridos' 
            });
        }
        
        // Actualizar metadata del usuario en Supabase Auth
        const { error } = await supabase.auth.updateUser({
            data: {
                nickname,
                phone,
                province,
                wallet,
                notifications
            }
        });
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Perfil actualizado correctamente'
        });
        
    } catch (error) {
        console.error('❌ Error al actualizar perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 9. CERRAR SESIÓN
app.post('/api/logout', verificarUsuarioSupabase, async (req, res) => {
    try {
        const { error } = await supabase.auth.signOut();
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Sesión cerrada exitosamente'
        });
        
    } catch (error) {
        console.error('❌ Error al cerrar sesión:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA ADMIN ==========

// 10. OBTENER TODOS LOS USUARIOS (admin)
app.get('/api/admin/users', verificarUsuarioSupabase, async (req, res) => {
    try {
        // Verificar que sea admin
        if (req.user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado' 
            });
        }
        
        // Obtener todos los usuarios (necesitas ser admin de Supabase)
        const { data: { users }, error } = await supabase.auth.admin.listUsers();
        
        if (error) {
            throw error;
        }
        
        // Filtrar y formatear usuarios
        const usuariosFormateados = users.map(user => ({
            id: user.id,
            email: user.email,
            user_id: user.user_metadata?.user_id || 'N/A',
            nickname: user.user_metadata?.nickname || 'Sin nickname',
            cwt: user.user_metadata?.cwt || 0,
            cws: user.user_metadata?.cws || 0,
            role: user.user_metadata?.role || 'user',
            verified: !!user.email_confirmed_at,
            phone: user.user_metadata?.phone || '',
            province: user.user_metadata?.province || '',
            created_at: user.created_at
        }));
        
        res.json({
            success: true,
            users: usuariosFormateados
        });
        
    } catch (error) {
        console.error('❌ Error al obtener usuarios:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 11. ACTUALIZAR SALDO (admin)
app.put('/api/admin/users/:userId/balance', verificarUsuarioSupabase, async (req, res) => {
    try {
        const { userId } = req.params;
        const { cwt, cws, note } = req.body;
        
        // Verificar que sea admin
        if (req.user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado' 
            });
        }
        
        if (cwt < 0 || cws < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Los balances no pueden ser negativos' 
            });
        }
        
        // Obtener usuario actual para conocer sus balances anteriores
        const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
        
        if (userError || !user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar metadata del usuario
        const { error } = await supabase.auth.admin.updateUserById(
            userId,
            {
                user_metadata: {
                    ...user.user_metadata,
                    cwt: parseFloat(cwt) || 0,
                    cws: parseInt(cws) || 0
                }
            }
        );
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Balance actualizado correctamente'
        });
        
    } catch (error) {
        console.error('❌ Error al actualizar balance:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA ARCHIVOS HTML ==========
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/login.html', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log(`🚀 Cromwell Pay con Supabase Auth ejecutándose en http://localhost:${PORT}`);
    console.log(`📧 Supabase Auth: ACTIVADO`);
    console.log(`🔗 URL Supabase: ${supabaseUrl}`);
    console.log('\n✅ VENTAJAS:');
    console.log('   • Email de verificación automático');
    console.log('   • Sin configuración de SMTP');
    console.log('   • 500,000 usuarios gratis/mes');
    console.log('   • Reenvío automático de emails');
    console.log('   • Tokens JWT automáticos');
});
