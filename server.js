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

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ========== FUNCIONES AUXILIARES ==========

function generarIDUsuario() {
    const fecha = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `CROM-${fecha.slice(-6)}${random}`;
}

// ========== MIDDLEWARE DE AUTENTICACIÓN ==========
const authenticateToken = async (req, res, next) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token de autenticación requerido' 
            });
        }
        
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token inválido o expirado' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Error en autenticación:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error de autenticación' 
        });
    }
};

// ========== RUTAS PÚBLICAS ==========

// 1. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.getUser();
        
        res.json({ 
            success: true, 
            status: '✅ Cromwell Pay - Sistema Funcionando',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 2. REGISTRO CON NICKNAME
app.post('/api/register', async (req, res) => {
    try {
        const { nickname, password, termsAccepted } = req.body;
        
        // Validaciones
        if (!nickname || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname y contraseña son requeridos' 
            });
        }
        
        if (!termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes aceptar los términos y condiciones' 
            });
        }
        
        // Validar formato del nickname
        const nicknameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!nicknameRegex.test(nickname)) {
            return res.status(400).json({ 
                success: false, 
                message: 'El nickname solo puede contener letras, números y guiones bajos (3-20 caracteres)' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }
        
        // Verificar si el nickname ya existe
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userExistsByNickname = users.find(u => 
            u.user_metadata?.nickname?.toLowerCase() === nickname.toLowerCase()
        );
        
        if (userExistsByNickname) {
            return res.status(400).json({ 
                success: false, 
                message: 'El nickname ya está en uso' 
            });
        }
        
        // Generar un email único basado en el nickname
        // Usamos un dominio ficticio para evitar problemas con emails reales
        const uniqueEmail = `${nickname.toLowerCase()}_${Date.now()}@cromwellpay.local`;
        const userId = generarIDUsuario();
        
        // Crear usuario en Supabase con email único
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: uniqueEmail,
            password: password,
            email_confirm: true, // Confirmamos automáticamente
            user_metadata: {
                nickname: nickname,
                user_id: userId,
                cwt: 0,
                cws: 0,
                role: 'user',
                phone: '',
                province: '',
                wallet_address: '',
                notifications: true,
                email_verified: true, // Sin verificación de email
                created_at: new Date().toISOString()
            }
        });
        
        if (authError) {
            console.error('❌ Error creando usuario:', authError.message);
            return res.status(400).json({ 
                success: false, 
                message: authError.message 
            });
        }
        
        console.log(`✅ Usuario registrado: ${nickname} (${userId})`);
        
        // Crear sesión para el usuario
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
            user_id: authData.user.id,
            session_data: {
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        });
        
        if (sessionError) {
            console.error('❌ Error creando sesión:', sessionError);
        }
        
        res.json({
            success: true,
            message: '¡Registro exitoso! Bienvenido a Cromwell Pay.',
            nickname: nickname,
            token: sessionData?.session?.access_token || null,
            user: {
                id: authData.user?.id,
                nickname: nickname,
                user_id: userId,
                email: uniqueEmail, // Solo para referencia interna
                role: 'user',
                verified: true,
                cwt: 0,
                cws: 0,
                phone: '',
                province: '',
                wallet_address: '',
                notifications: true,
                created_at: new Date().toISOString()
            },
            note: 'Tu cuenta ha sido creada exitosamente. No necesitas verificar email.'
        });
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. LOGIN CON NICKNAME
app.post('/api/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        
        if (!nickname || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname y contraseña son requeridos' 
            });
        }
        
        // Buscar usuario por nickname
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const targetUser = users.find(u => 
            u.user_metadata?.nickname?.toLowerCase() === nickname.toLowerCase()
        );
        
        if (!targetUser) {
            console.error('❌ Usuario no encontrado:', nickname);
            return res.status(401).json({ 
                success: false, 
                message: 'Nickname o contraseña incorrectos' 
            });
        }
        
        // Intentar login con el email del usuario
        const { data, error } = await supabase.auth.signInWithPassword({
            email: targetUser.email,
            password: password
        });
        
        if (error) {
            console.error('❌ Error en login:', error.message);
            return res.status(401).json({ 
                success: false, 
                message: 'Nickname o contraseña incorrectos' 
            });
        }
        
        // ÉXITO
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token: data.session.access_token,
            user: {
                id: data.user.id,
                nickname: data.user.user_metadata?.nickname || nickname,
                user_id: data.user.user_metadata?.user_id || generarIDUsuario(),
                email: data.user.email, // Solo para referencia interna
                role: data.user.user_metadata?.role || 'user',
                verified: true,
                cwt: data.user.user_metadata?.cwt || 0,
                cws: data.user.user_metadata?.cws || 0,
                phone: data.user.user_metadata?.phone || '',
                province: data.user.user_metadata?.province || '',
                wallet_address: data.user.user_metadata?.wallet_address || '',
                notifications: data.user.user_metadata?.notifications !== false,
                created_at: data.user.user_metadata?.created_at || data.user.created_at
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

// ========== RUTAS PROTEGIDAS ==========

// 4. VERIFICAR TOKEN
app.get('/api/verify-token', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        res.json({
            success: true,
            user: {
                id: user.id,
                nickname: user.user_metadata?.nickname || 'Usuario',
                user_id: user.user_metadata?.user_id || generarIDUsuario(),
                email: user.email, // Solo para referencia interna
                role: user.user_metadata?.role || 'user',
                verified: true,
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0,
                phone: user.user_metadata?.phone || '',
                province: user.user_metadata?.province || '',
                wallet_address: user.user_metadata?.wallet_address || '',
                notifications: user.user_metadata?.notifications !== false,
                created_at: user.user_metadata?.created_at || user.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error verificando token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al verificar token' 
        });
    }
});

// 5. DASHBOARD - Obtener datos completos del usuario
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        res.json({
            success: true,
            user: {
                id: user.id,
                nickname: user.user_metadata?.nickname || 'Usuario',
                user_id: user.user_metadata?.user_id || generarIDUsuario(),
                email: user.email,
                role: user.user_metadata?.role || 'user',
                verified: true,
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0,
                phone: user.user_metadata?.phone || '',
                province: user.user_metadata?.province || '',
                wallet_address: user.user_metadata?.wallet_address || '',
                notifications: user.user_metadata?.notifications !== false,
                created_at: user.user_metadata?.created_at || user.created_at
            },
            dashboard: {
                total_balance: (user.user_metadata?.cwt || 0) + (user.user_metadata?.cws || 0),
                transactions_today: 0,
                pending_transactions: 0,
                last_login: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 6. OBTENER PERFIL DEL USUARIO
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        res.json({
            success: true,
            profile: {
                id: user.id,
                nickname: user.user_metadata?.nickname || 'Usuario',
                user_id: user.user_metadata?.user_id || generarIDUsuario(),
                phone: user.user_metadata?.phone || '',
                province: user.user_metadata?.province || '',
                wallet_address: user.user_metadata?.wallet_address || '',
                notifications: user.user_metadata?.notifications !== false,
                created_at: user.user_metadata?.created_at || user.created_at,
                last_updated: user.updated_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 7. ACTUALIZAR PERFIL
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { nickname, phone, province, wallet_address, notifications } = req.body;
        
        // Validar campos requeridos
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname, teléfono y provincia son requeridos' 
            });
        }
        
        // Verificar si el nuevo nickname ya existe (excepto para el usuario actual)
        if (nickname !== user.user_metadata?.nickname) {
            const { data: { users } } = await supabase.auth.admin.listUsers();
            const nicknameExists = users.find(u => 
                u.id !== user.id && 
                u.user_metadata?.nickname?.toLowerCase() === nickname.toLowerCase()
            );
            
            if (nicknameExists) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El nickname ya está en uso por otro usuario' 
                });
            }
        }
        
        // Actualizar usuario en Supabase
        const { error } = await supabase.auth.updateUser({
            data: {
                nickname,
                phone,
                province,
                wallet_address: wallet_address || '',
                notifications: notifications !== false
            }
        });
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Perfil actualizado correctamente',
            profile: {
                nickname,
                phone,
                province,
                wallet_address,
                notifications: notifications !== false,
                updated_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error actualizando perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 8. OBTENER BALANCE
app.get('/api/user/balance', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        res.json({
            success: true,
            balance: {
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0,
                total: (user.user_metadata?.cwt || 0) + (user.user_metadata?.cws || 0),
                currency: 'USD',
                last_updated: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo balance:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 9. CAMBIAR CONTRASEÑA
app.post('/api/user/change-password', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { currentPassword, newPassword, confirmPassword } = req.body;
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Todos los campos son requeridos' 
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La nueva contraseña debe tener al menos 6 caracteres' 
            });
        }
        
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Las contraseñas nuevas no coinciden' 
            });
        }
        
        // Verificar contraseña actual intentando hacer login
        const { error: loginError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: currentPassword
        });
        
        if (loginError) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña actual es incorrecta' 
            });
        }
        
        // Actualizar contraseña
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });
        
    } catch (error) {
        console.error('❌ Error cambiando contraseña:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 10. LOGOUT
app.post('/api/logout', authenticateToken, async (req, res) => {
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
        console.error('❌ Error cerrando sesión:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== ADMIN ROUTES ==========

// 11. OBTENER TODOS LOS USUARIOS (admin)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        if (user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado. Solo administradores.' 
            });
        }
        
        const { data: { users }, error } = await supabase.auth.admin.listUsers();
        
        if (error) {
            throw error;
        }
        
        const usuariosFormateados = users.map(u => ({
            id: u.id,
            nickname: u.user_metadata?.nickname || 'Sin nickname',
            user_id: u.user_metadata?.user_id || 'N/A',
            cwt: u.user_metadata?.cwt || 0,
            cws: u.user_metadata?.cws || 0,
            role: u.user_metadata?.role || 'user',
            phone: u.user_metadata?.phone || '',
            province: u.user_metadata?.province || '',
            wallet_address: u.user_metadata?.wallet_address || '',
            created_at: u.created_at,
            last_sign_in: u.last_sign_in_at
        }));
        
        res.json({
            success: true,
            total_users: usuariosFormateados.length,
            users: usuariosFormateados
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo usuarios:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 12. ACTUALIZAR SALDO DE USUARIO (admin)
app.put('/api/admin/users/:userId/balance', authenticateToken, async (req, res) => {
    try {
        const adminUser = req.user;
        const { userId } = req.params;
        const { cwt, cws, operation, reason } = req.body;
        
        if (adminUser.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado. Solo administradores.' 
            });
        }
        
        // Obtener usuario objetivo
        const { data: { user: targetUser }, error: userError } = await supabase.auth.admin.getUserById(userId);
        
        if (userError || !targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        const currentCWT = targetUser.user_metadata?.cwt || 0;
        const currentCWS = targetUser.user_metadata?.cws || 0;
        
        let newCWT = currentCWT;
        let newCWS = currentCWS;
        
        if (operation === 'add') {
            newCWT += parseFloat(cwt) || 0;
            newCWS += parseInt(cws) || 0;
        } else if (operation === 'subtract') {
            newCWT -= parseFloat(cwt) || 0;
            newCWS -= parseInt(cws) || 0;
        } else {
            newCWT = parseFloat(cwt) || 0;
            newCWS = parseInt(cws) || 0;
        }
        
        // Asegurar que no sean negativos
        if (newCWT < 0) newCWT = 0;
        if (newCWS < 0) newCWS = 0;
        
        // Actualizar usuario
        const { error } = await supabase.auth.admin.updateUserById(
            userId,
            {
                user_metadata: {
                    ...targetUser.user_metadata,
                    cwt: newCWT,
                    cws: newCWS
                }
            }
        );
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Balance actualizado correctamente',
            user: {
                id: targetUser.id,
                nickname: targetUser.user_metadata?.nickname || 'Usuario',
                balance: {
                    previous: { cwt: currentCWT, cws: currentCWS },
                    current: { cwt: newCWT, cws: newCWS },
                    operation,
                    reason: reason || 'Actualización administrativa',
                    updated_by: adminUser.user_metadata?.nickname || adminUser.email,
                    timestamp: new Date().toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error actualizando balance de usuario:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 13. CAMBIAR ROL DE USUARIO (admin)
app.put('/api/admin/users/:userId/role', authenticateToken, async (req, res) => {
    try {
        const adminUser = req.user;
        const { userId } = req.params;
        const { role } = req.body;
        
        if (adminUser.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado. Solo administradores.' 
            });
        }
        
        if (!['admin', 'user', 'moderator'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rol inválido. Roles permitidos: admin, user, moderator' 
            });
        }
        
        // Obtener usuario objetivo
        const { data: { user: targetUser }, error: userError } = await supabase.auth.admin.getUserById(userId);
        
        if (userError || !targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar rol
        const { error } = await supabase.auth.admin.updateUserById(
            userId,
            {
                user_metadata: {
                    ...targetUser.user_metadata,
                    role: role
                }
            }
        );
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: `Rol actualizado a ${role}`,
            user: {
                id: targetUser.id,
                nickname: targetUser.user_metadata?.nickname || 'Usuario',
                previous_role: targetUser.user_metadata?.role || 'user',
                new_role: role,
                updated_by: adminUser.user_metadata?.nickname || adminUser.email,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error cambiando rol:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA TRANSACCIONES ==========

// 14. OBTENER TRANSACCIONES DEL USUARIO
app.get('/api/user/transactions', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        // En un sistema real, esto vendría de una base de datos de transacciones
        // Por ahora, devolvemos datos de ejemplo
        
        const transactions = [
            {
                id: 'TXN-001',
                type: 'deposit',
                amount: 100,
                currency: 'CWT',
                status: 'completed',
                date: new Date().toISOString(),
                description: 'Depósito inicial'
            },
            {
                id: 'TXN-002',
                type: 'withdrawal',
                amount: 50,
                currency: 'CWS',
                status: 'pending',
                date: new Date(Date.now() - 86400000).toISOString(),
                description: 'Retiro de tokens'
            }
        ];
        
        res.json({
            success: true,
            transactions: transactions,
            total: transactions.length,
            balance: {
                cwt: user.user_metadata?.cwt || 0,
                cws: user.user_metadata?.cws || 0
            }
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo transacciones:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA ARCHIVOS HTML ==========
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.get('/login.html', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

app.get('/admin.html', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

// Eliminar verify-email.html ya que no lo necesitamos más
app.get('/verify-email.html', (req, res) => {
    res.redirect('/login.html');
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, async () => {
    console.log(`🚀 Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`🔗 Supabase: ${supabaseUrl}`);
    
    console.log('\n✅ SISTEMA SIMPLIFICADO CON NICKNAME:');
    console.log('   • Registro: Solo nickname y contraseña');
    console.log('   • Login: Solo nickname y contraseña');
    console.log('   • NO se requiere email');
    console.log('   • NO hay verificación de email');
    console.log('   • Cuentas activas inmediatamente');
    
    console.log('\n✅ ENDPOINTS DISPONIBLES:');
    console.log('   PÚBLICOS:');
    console.log('   • GET  /api/status');
    console.log('   • POST /api/register');
    console.log('   • POST /api/login');
    
    console.log('\n   PROTEGIDOS:');
    console.log('   • GET  /api/verify-token');
    console.log('   • GET  /api/dashboard');
    console.log('   • GET  /api/user/profile');
    console.log('   • PUT  /api/user/profile');
    console.log('   • GET  /api/user/balance');
    console.log('   • POST /api/user/change-password');
    console.log('   • GET  /api/user/transactions');
    console.log('   • POST /api/logout');
    
    console.log('\n   ADMIN:');
    console.log('   • GET  /api/admin/users');
    console.log('   • PUT  /api/admin/users/:userId/balance');
    console.log('   • PUT  /api/admin/users/:userId/role');
    
    console.log('\n📋 SISTEMA LISTO:');
    console.log('   • Usuarios se registran solo con nickname');
    console.log('   • No hay problemas con emails incorrectos');
    console.log('   • Login inmediato después del registro');
    console.log('   • Dashboard completo');
    console.log('   • Gestión de tokens CWT/CWS');
});
