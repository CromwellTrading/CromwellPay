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

// Supabase Client - USAR VARIABLES DE ENTORNO
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Service Role Key para admin
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

// Middleware para verificar rol de admin
const requireAdmin = async (req, res, next) => {
    try {
        const user = req.user;
        
        // Verificar si es admin desde la tabla profiles
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        
        if (error || !profile || profile.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado. Se requieren permisos de administrador.' 
            });
        }
        
        next();
    } catch (error) {
        console.error('Error verificando admin:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error verificando permisos' 
        });
    }
};

// ========== RUTAS PÚBLICAS ==========

// 1. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        res.json({ 
            success: true, 
            status: '✅ Cromwell Pay - Sistema Funcionando',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            auth_type: 'nickname_only'
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
        
        // Verificar si el nickname ya existe en profiles
        const { data: existingProfile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('nickname', nickname.toLowerCase())
            .single();
        
        if (existingProfile) {
            return res.status(400).json({ 
                success: false, 
                message: 'El nickname ya está en uso' 
            });
        }
        
        // Generar un email único basado en el nickname
        const uniqueEmail = `${nickname.toLowerCase()}_${Date.now()}@cromwellpay.local`;
        const userId = generarIDUsuario();
        
        // Crear usuario en Supabase con email único
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: uniqueEmail,
            password: password,
            email_confirm: true,
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
        
        // Insertar en tabla profiles
        const { error: profileError } = await supabase
            .from('profiles')
            .insert({
                id: authData.user.id,
                nickname: nickname,
                user_id: userId,
                role: 'user',
                cwt: 0,
                cws: 0,
                phone: '',
                province: '',
                wallet_address: '',
                notifications: true
            });
        
        if (profileError) {
            console.error('❌ Error creando perfil:', profileError);
            // Revertir creación de usuario
            await supabase.auth.admin.deleteUser(authData.user.id);
            return res.status(400).json({ 
                success: false, 
                message: 'Error creando perfil de usuario' 
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
                role: 'user',
                verified: true,
                cwt: 0,
                cws: 0,
                phone: '',
                province: '',
                wallet_address: '',
                notifications: true,
                created_at: new Date().toISOString()
            }
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
        
        // Buscar usuario por nickname en profiles
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, nickname')
            .eq('nickname', nickname)
            .single();
        
        if (profileError || !profile) {
            console.error('❌ Usuario no encontrado:', nickname);
            return res.status(401).json({ 
                success: false, 
                message: 'Nickname o contraseña incorrectos' 
            });
        }
        
        // Obtener el email del usuario desde auth.users
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const targetUser = users.find(u => u.id === profile.id);
        
        if (!targetUser) {
            console.error('❌ Usuario no encontrado en auth:', nickname);
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
        
        // Obtener datos completos del perfil
        const { data: fullProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();
        
        // ÉXITO
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token: data.session.access_token,
            user: {
                id: data.user.id,
                nickname: fullProfile.nickname,
                user_id: fullProfile.user_id,
                role: fullProfile.role,
                verified: true,
                cwt: fullProfile.cwt,
                cws: fullProfile.cws,
                phone: fullProfile.phone || '',
                province: fullProfile.province || '',
                wallet_address: fullProfile.wallet_address || '',
                notifications: fullProfile.notifications !== false,
                created_at: fullProfile.created_at
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
        
        // Obtener datos del perfil
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        
        if (error || !profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Perfil no encontrado' 
            });
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                role: profile.role,
                verified: true,
                cwt: profile.cwt,
                cws: profile.cws,
                phone: profile.phone || '',
                province: profile.province || '',
                wallet_address: profile.wallet_address || '',
                notifications: profile.notifications !== false,
                created_at: profile.created_at
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
        
        // Obtener perfil
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        
        if (profileError || !profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Perfil no encontrado' 
            });
        }
        
        // Obtener transacciones recientes
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(5);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                role: profile.role,
                cwt: profile.cwt,
                cws: profile.cws,
                phone: profile.phone || '',
                province: profile.province || '',
                wallet_address: profile.wallet_address || '',
                notifications: profile.notifications !== false,
                created_at: profile.created_at
            },
            dashboard: {
                total_balance: (profile.cwt || 0) + (profile.cws || 0),
                total_cwt: profile.cwt,
                total_cws: profile.cws,
                recent_transactions: transactions || [],
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
        
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        
        if (error || !profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Perfil no encontrado' 
            });
        }
        
        res.json({
            success: true,
            profile: {
                id: user.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                phone: profile.phone || '',
                province: profile.province || '',
                wallet_address: profile.wallet_address || '',
                notifications: profile.notifications !== false,
                created_at: profile.created_at,
                updated_at: profile.updated_at
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
        if (nickname.toLowerCase() !== user.user_metadata?.nickname?.toLowerCase()) {
            const { data: existingProfile } = await supabase
                .from('profiles')
                .select('id')
                .eq('nickname', nickname.toLowerCase())
                .neq('id', user.id)
                .single();
            
            if (existingProfile) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El nickname ya está en uso por otro usuario' 
                });
            }
        }
        
        // Actualizar en tabla profiles
        const { error: profileError } = await supabase
            .from('profiles')
            .update({
                nickname: nickname,
                phone: phone,
                province: province,
                wallet_address: wallet_address || '',
                notifications: notifications !== false,
                updated_at: new Date().toISOString()
            })
            .eq('id', user.id);
        
        if (profileError) {
            throw profileError;
        }
        
        // Actualizar metadata en auth.users
        const { error: authError } = await supabase.auth.updateUser({
            data: {
                nickname: nickname,
                phone: phone,
                province: province,
                wallet_address: wallet_address || '',
                notifications: notifications !== false
            }
        });
        
        if (authError) {
            console.warn('⚠️ Error actualizando auth metadata:', authError.message);
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
        
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('cwt, cws')
            .eq('id', user.id)
            .single();
        
        if (error || !profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Perfil no encontrado' 
            });
        }
        
        res.json({
            success: true,
            balance: {
                cwt: profile.cwt || 0,
                cws: profile.cws || 0,
                total: (profile.cwt || 0) + (profile.cws || 0),
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
        
        // Obtener email del usuario
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const targetUser = users.find(u => u.id === user.id);
        
        if (!targetUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Verificar contraseña actual intentando hacer login
        const { error: loginError } = await supabase.auth.signInWithPassword({
            email: targetUser.email,
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

// ========== RUTAS DE ADMIN ==========

// 11. OBTENER TODOS LOS USUARIOS (admin)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { search = '', page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        // Construir query base
        let query = supabase
            .from('profiles')
            .select('*', { count: 'exact' });
        
        // Aplicar filtro de búsqueda si existe
        if (search) {
            query = query.or(`nickname.ilike.%${search}%,user_id.ilike.%${search}%,phone.ilike.%${search}%`);
        }
        
        // Paginación y orden
        const { data: users, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            total_users: count || 0,
            current_page: parseInt(page),
            total_pages: Math.ceil((count || 0) / limit),
            users: users || []
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
app.put('/api/admin/users/:userId/balance', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const adminUser = req.user;
        const { userId } = req.params;
        const { cwt, cws, operation, reason } = req.body;
        
        // Validar operación
        if (!['add', 'subtract', 'set'].includes(operation)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Operación no válida. Use: add, subtract o set' 
            });
        }
        
        // Obtener usuario objetivo
        const { data: targetUser, error: userError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (userError || !targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        const currentCWT = targetUser.cwt || 0;
        const currentCWS = targetUser.cws || 0;
        
        let newCWT = currentCWT;
        let newCWS = currentCWS;
        
        // Calcular nuevo balance
        if (operation === 'add') {
            newCWT += parseFloat(cwt) || 0;
            newCWS += parseInt(cws) || 0;
        } else if (operation === 'subtract') {
            newCWT = Math.max(currentCWT - (parseFloat(cwt) || 0), 0);
            newCWS = Math.max(currentCWS - (parseInt(cws) || 0), 0);
        } else {
            newCWT = Math.max(parseFloat(cwt) || 0, 0);
            newCWS = Math.max(parseInt(cws) || 0, 0);
        }
        
        // Actualizar balance en profiles
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                cwt: newCWT,
                cws: newCWS,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (updateError) {
            throw updateError;
        }
        
        // Crear transacción de balance
        const { error: transactionError } = await supabase
            .from('transactions')
            .insert({
                transaction_id: `ADMIN-${Date.now()}`,
                user_id: userId,
                type: `admin_${operation}`,
                status: 'completed',
                amount_cwt: operation === 'set' ? newCWT - currentCWT : parseFloat(cwt) || 0,
                amount_cws: operation === 'set' ? newCWS - currentCWS : parseInt(cws) || 0,
                description: reason || 'Actualización administrativa de balance',
                admin_id: adminUser.id,
                created_at: new Date().toISOString(),
                completed_at: new Date().toISOString()
            });
        
        if (transactionError) {
            console.error('❌ Error creando transacción:', transactionError);
        }
        
        // Registrar en balance_history
        const { error: historyError } = await supabase
            .from('balance_history')
            .insert({
                user_id: userId,
                previous_cwt: currentCWT,
                previous_cws: currentCWS,
                new_cwt: newCWT,
                new_cws: newCWS,
                operation: operation,
                source: 'admin',
                admin_id: adminUser.id,
                reason: reason || 'Actualización administrativa',
                created_at: new Date().toISOString()
            });
        
        if (historyError) {
            console.error('❌ Error registrando historial:', historyError);
        }
        
        res.json({
            success: true,
            message: 'Balance actualizado correctamente',
            user: {
                id: targetUser.id,
                nickname: targetUser.nickname,
                user_id: targetUser.user_id,
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
app.put('/api/admin/users/:userId/role', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const adminUser = req.user;
        const { userId } = req.params;
        const { role } = req.body;
        
        if (!['admin', 'user', 'moderator'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rol inválido. Roles permitidos: admin, user, moderator' 
            });
        }
        
        // Obtener usuario objetivo
        const { data: targetUser, error: userError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (userError || !targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar rol
        const { error } = await supabase
            .from('profiles')
            .update({
                role: role,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (error) {
            throw error;
        }
        
        // Actualizar metadata en auth
        const { error: authError } = await supabase.auth.admin.updateUserById(
            userId,
            {
                user_metadata: {
                    ...targetUser.user_metadata,
                    role: role
                }
            }
        );
        
        if (authError) {
            console.warn('⚠️ Error actualizando auth metadata:', authError.message);
        }
        
        res.json({
            success: true,
            message: `Rol actualizado a ${role}`,
            user: {
                id: targetUser.id,
                nickname: targetUser.nickname,
                user_id: targetUser.user_id,
                previous_role: targetUser.role,
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

// 14. OBTENER DETALLES DE USUARIO ESPECÍFICO (admin)
app.get('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Obtener perfil del usuario
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (profileError || !profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Obtener transacciones del usuario
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        // Obtener historial de balance
        const { data: balanceHistory } = await supabase
            .from('balance_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        res.json({
            success: true,
            user: profile,
            transactions: transactions || [],
            balance_history: balanceHistory || [],
            statistics: {
                total_transactions: transactions?.length || 0,
                total_deposits: transactions?.filter(t => t.type.includes('deposit')).length || 0,
                total_withdrawals: transactions?.filter(t => t.type.includes('withdrawal')).length || 0
            }
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo detalles de usuario:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PARA TRANSACCIONES ==========

// 15. OBTENER TRANSACCIONES DEL USUARIO
app.get('/api/user/transactions', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { type, status, startDate, endDate, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = supabase
            .from('transactions')
            .select('*', { count: 'exact' })
            .eq('user_id', user.id);
        
        // Aplicar filtros
        if (type) query = query.eq('type', type);
        if (status) query = query.eq('status', status);
        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);
        
        const { data: transactions, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) {
            throw error;
        }
        
        // Obtener balance actual
        const { data: profile } = await supabase
            .from('profiles')
            .select('cwt, cws')
            .eq('id', user.id)
            .single();
        
        res.json({
            success: true,
            transactions: transactions || [],
            total: count || 0,
            current_page: parseInt(page),
            total_pages: Math.ceil((count || 0) / limit),
            balance: {
                cwt: profile?.cwt || 0,
                cws: profile?.cws || 0
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

// 16. CREAR NUEVA TRANSACCIÓN
app.post('/api/user/transactions', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { type, amount_cwt, amount_cws, description, metadata } = req.body;
        
        if (!type || (!amount_cwt && !amount_cws)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tipo y monto son requeridos' 
            });
        }
        
        // Verificar balance si es retiro
        if (type === 'withdrawal') {
            const { data: profile } = await supabase
                .from('profiles')
                .select('cwt, cws')
                .eq('id', user.id)
                .single();
            
            if ((amount_cwt && profile.cwt < amount_cwt) || 
                (amount_cws && profile.cws < amount_cws)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Balance insuficiente' 
                });
            }
        }
        
        // Crear transacción
        const transactionData = {
            transaction_id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            user_id: user.id,
            type: type,
            status: 'pending',
            amount_cwt: parseFloat(amount_cwt) || 0,
            amount_cws: parseInt(amount_cws) || 0,
            description: description || '',
            metadata: metadata || {},
            created_at: new Date().toISOString()
        };
        
        const { data: transaction, error } = await supabase
            .from('transactions')
            .insert(transactionData)
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        res.json({
            success: true,
            message: 'Transacción creada exitosamente',
            transaction: transaction
        });
        
    } catch (error) {
        console.error('❌ Error creando transacción:', error);
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

app.get('/register.html', (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, async () => {
    console.log(`🚀 Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`🔗 Supabase URL: ${supabaseUrl ? '✅ Configurada' : '❌ Faltante'}`);
    console.log(`🔑 Service Key: ${supabaseKey ? '✅ Configurada' : '❌ FALTANTE - Configura SUPABASE_SERVICE_KEY en .env'}`);
    
    console.log('\n✅ SISTEMA CON NICKNAME:');
    console.log('   • Registro: Solo nickname y contraseña');
    console.log('   • Login: Solo nickname y contraseña');
    console.log('   • NO se requiere email para login');
    console.log('   • NO hay verificación de email');
    console.log('   • Cuentas activas inmediatamente');
    
    console.log('\n📁 ARCHIVOS REQUERIDOS en la raíz del proyecto:');
    console.log('   • login.html (página de inicio de sesión)');
    console.log('   • register.html (página de registro)');
    console.log('   • dashboard.html (panel de usuario)');
    console.log('   • admin.html (panel de administrador)');
    
    console.log('\n⚠️  CONFIGURACIÓN REQUERIDA:');
    console.log('   1. Crea un archivo .env con:');
    console.log('      SUPABASE_URL=https://tu-proyecto.supabase.co');
    console.log('      SUPABASE_SERVICE_KEY=tu-service-role-key');
    console.log('      PORT=3000');
    
    console.log('\n   2. Ejecuta las tablas SQL en Supabase');
    console.log('   3. Crea el usuario admin con el SQL proporcionado');
    
    console.log('\n📋 SISTEMA LISTO PARA USAR');
});
