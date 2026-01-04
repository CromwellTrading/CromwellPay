const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIGURACIÓN ==========
app.use(cors());
app.use(express.json());

// Archivos estáticos desde 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Redirecciones amigables
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/login', (req, res) => res.redirect('/login.html'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/register', (req, res) => res.redirect('/register.html'));

// ========== VERIFICACIÓN DE VARIABLES CRÍTICAS ==========
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERROR CRÍTICO: Faltan variables de entorno');
    console.error('   SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridas');
    console.error('   Crea un archivo .env con estas variables');
    process.exit(1);
}

// Cliente Supabase con Service Role Key
const supabase = createClient(supabaseUrl, supabaseKey);

// ========== FUNCIONES AUXILIARES ==========
function generarIDUsuario() {
    const fecha = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `CROM-${fecha.slice(-6)}${random}`;
}

// ========== MIDDLEWARE DE SEGURIDAD ==========
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
        console.error('❌ Error en autenticación:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error de autenticación' 
        });
    }
};

// Middleware para ADMIN EXCLUSIVO (solo Ersatz)
const requireAdmin = async (req, res, next) => {
    try {
        const user = req.user;
        
        // Verificar en la tabla profiles
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role, nickname')
            .eq('id', user.id)
            .single();
        
        if (error || !profile) {
            return res.status(403).json({ 
                success: false, 
                message: 'Perfil no encontrado' 
            });
        }
        
        // SOLO Ersatz puede ser admin
        if (profile.role !== 'admin' || profile.nickname !== 'Ersatz') {
            console.warn(`⚠️ Intento de acceso admin no autorizado: ${profile.nickname}`);
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado. Solo el administrador principal puede acceder.' 
            });
        }
        
        next();
    } catch (error) {
        console.error('❌ Error verificando admin:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error verificando permisos' 
        });
    }
};

// ========== RUTAS PÚBLICAS ==========

// Estado del sistema
app.get('/api/status', async (req, res) => {
    try {
        res.json({ 
            success: true, 
            status: '✅ Cromwell Pay - Sistema Seguro Funcionando',
            timestamp: new Date().toISOString(),
            version: '3.0.0',
            security: 'auth_by_nickname',
            admin: 'Ersatz'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// REGISTRO SEGURO
app.post('/api/register', async (req, res) => {
    try {
        const { nickname, password, termsAccepted } = req.body;
        
        // Validaciones estrictas
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
        
        const nicknameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!nicknameRegex.test(nickname)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname inválido (3-20 caracteres, solo letras, números y _)' 
            });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 8 caracteres' 
            });
        }
        
        // Verificar nickname único (case insensitive)
        const { data: existingProfile } = await supabase
            .from('profiles')
            .select('nickname')
            .ilike('nickname', nickname)
            .single();
        
        if (existingProfile) {
            return res.status(400).json({ 
                success: false, 
                message: 'El nickname ya está registrado' 
            });
        }
        
        // Generar datos únicos
        const uniqueEmail = `${nickname.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@cromwellpay.local`;
        const userId = generarIDUsuario();
        
        console.log(`📝 Registrando: ${nickname} -> ${uniqueEmail}`);
        
        // 1. Crear usuario en auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: uniqueEmail,
            password: password,
            email_confirm: true,
            user_metadata: {
                nickname: nickname,
                user_id: userId,
                role: 'user',
                cwt: 0,
                cws: 0
            }
        });
        
        if (authError) {
            console.error('❌ Error auth:', authError.message);
            return res.status(400).json({ 
                success: false, 
                message: 'Error al crear cuenta: ' + authError.message 
            });
        }
        
        // 2. Crear perfil en tabla profiles
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
            console.error('❌ Error profile:', profileError);
            // Limpiar usuario auth si falla
            await supabase.auth.admin.deleteUser(authData.user.id);
            return res.status(400).json({ 
                success: false, 
                message: 'Error al crear perfil' 
            });
        }
        
        // 3. Crear sesión automática
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
            user_id: authData.user.id,
            session_data: {
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        });
        
        const token = sessionError ? null : sessionData?.session?.access_token;
        
        console.log(`✅ Usuario registrado: ${nickname} (${userId})`);
        
        res.json({
            success: true,
            message: '¡Registro exitoso! Bienvenido.',
            nickname: nickname,
            token: token,
            user: {
                id: authData.user.id,
                nickname: nickname,
                user_id: userId,
                role: 'user',
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
        console.error('❌ Error registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// LOGIN SEGURO
app.post('/api/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        
        if (!nickname || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname y contraseña son requeridos' 
            });
        }
        
        console.log(`🔍 Login intento: ${nickname}`);
        
        // Buscar perfil por nickname
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('nickname', nickname)
            .single();
        
        if (profileError || !profile) {
            console.log(`❌ Nickname no encontrado: ${nickname}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        // Obtener email del usuario desde auth
        const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
        
        if (usersError) {
            console.error('❌ Error obteniendo usuarios:', usersError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error del servidor' 
            });
        }
        
        const authUser = users.find(u => u.id === profile.id);
        
        if (!authUser) {
            console.error(`❌ Usuario auth no encontrado para: ${nickname}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        // Intentar login con email y password
        const { data, error } = await supabase.auth.signInWithPassword({
            email: authUser.email,
            password: password
        });
        
        if (error) {
            console.error(`❌ Login fallido para ${nickname}:`, error.message);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        console.log(`✅ Login exitoso: ${nickname}`);
        
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token: data.session.access_token,
            user: {
                id: profile.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                role: profile.role,
                cwt: profile.cwt || 0,
                cws: profile.cws || 0,
                phone: profile.phone || '',
                province: profile.province || '',
                wallet_address: profile.wallet_address || '',
                notifications: profile.notifications !== false,
                created_at: profile.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS PROTEGIDAS PARA USUARIOS ==========

// Verificar token
app.get('/api/verify-token', authenticateToken, async (req, res) => {
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
            user: {
                id: profile.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                role: profile.role,
                cwt: profile.cwt || 0,
                cws: profile.cws || 0,
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

// Dashboard usuario
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
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
        
        res.json({
            success: true,
            user: {
                id: profile.id,
                nickname: profile.nickname,
                user_id: profile.user_id,
                role: profile.role,
                cwt: profile.cwt || 0,
                cws: profile.cws || 0,
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

// Perfil usuario
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
                id: profile.id,
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

// Actualizar perfil (usuarios normales)
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { nickname, phone, province, wallet_address, notifications } = req.body;
        
        // Validaciones
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname, teléfono y provincia son requeridos' 
            });
        }
        
        // Verificar que el nickname no exista (excepto para el mismo usuario)
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
                    message: 'El nickname ya está en uso' 
                });
            }
        }
        
        // Actualizar perfil (SOLO campos permitidos, NO rol)
        const { error: updateError } = await supabase
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
        
        if (updateError) {
            throw updateError;
        }
        
        // Actualizar metadata en auth
        await supabase.auth.updateUser({
            data: {
                nickname: nickname,
                phone: phone,
                province: province,
                wallet_address: wallet_address || '',
                notifications: notifications !== false
            }
        });
        
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

// Balance usuario
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

// Cambiar contraseña
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
        
        if (newPassword.length < 8) {
            return res.status(400).json({ 
                success: false, 
                message: 'La nueva contraseña debe tener al menos 8 caracteres' 
            });
        }
        
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Las contraseñas no coinciden' 
            });
        }
        
        // Obtener usuario auth
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const authUser = users.find(u => u.id === user.id);
        
        if (!authUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Verificar contraseña actual
        const { error: loginError } = await supabase.auth.signInWithPassword({
            email: authUser.email,
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

// Logout
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

// ========== RUTAS EXCLUSIVAS PARA ADMIN (SOLO Ersatz) ==========

// Listar todos los usuarios
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { search = '', page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = supabase
            .from('profiles')
            .select('*', { count: 'exact' });
        
        if (search) {
            query = query.or(`nickname.ilike.%${search}%,user_id.ilike.%${search}%,phone.ilike.%${search}%`);
        }
        
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

// Actualizar balance de usuario (SOLO ADMIN)
app.put('/api/admin/users/:userId/balance', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const adminUser = req.user;
        const { userId } = req.params;
        const { cwt, cws, operation, reason } = req.body;
        
        // Validar operación
        if (!['add', 'subtract', 'set'].includes(operation)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Operación inválida' 
            });
        }
        
        // Obtener usuario
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
        
        // Calcular nuevo balance
        let newCWT = targetUser.cwt || 0;
        let newCWS = targetUser.cws || 0;
        
        if (operation === 'add') {
            newCWT += parseFloat(cwt) || 0;
            newCWS += parseInt(cws) || 0;
        } else if (operation === 'subtract') {
            newCWT = Math.max(newCWT - (parseFloat(cwt) || 0), 0);
            newCWS = Math.max(newCWS - (parseInt(cws) || 0), 0);
        } else if (operation === 'set') {
            newCWT = Math.max(parseFloat(cwt) || 0, 0);
            newCWS = Math.max(parseInt(cws) || 0, 0);
        }
        
        // Actualizar balance
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
        
        // Registrar en balance_history
        await supabase
            .from('balance_history')
            .insert({
                user_id: userId,
                previous_cwt: targetUser.cwt || 0,
                previous_cws: targetUser.cws || 0,
                new_cwt: newCWT,
                new_cws: newCWS,
                operation: operation,
                source: 'admin',
                admin_id: adminUser.id,
                reason: reason || 'Ajuste administrativo',
                created_at: new Date().toISOString()
            });
        
        // Crear transacción de registro
        await supabase
            .from('transactions')
            .insert({
                transaction_id: `ADJ-${Date.now()}`,
                user_id: userId,
                type: 'admin_adjustment',
                status: 'completed',
                amount_cwt: newCWT - (targetUser.cwt || 0),
                amount_cws: newCWS - (targetUser.cws || 0),
                description: reason || 'Ajuste de balance por administrador',
                admin_id: adminUser.id,
                created_at: new Date().toISOString(),
                completed_at: new Date().toISOString()
            });
        
        res.json({
            success: true,
            message: 'Balance actualizado correctamente',
            user: {
                id: targetUser.id,
                nickname: targetUser.nickname,
                balance: {
                    previous: { cwt: targetUser.cwt || 0, cws: targetUser.cws || 0 },
                    current: { cwt: newCWT, cws: newCWS },
                    operation: operation,
                    reason: reason || 'Ajuste administrativo'
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error actualizando balance:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// Detalles específicos de usuario
app.get('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
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
            .limit(10);
        
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
            balance_history: balanceHistory || []
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo detalles:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== RUTAS DE TRANSACCIONES (SOLO ADMIN) ==========

// Listar transacciones
app.get('/api/transactions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId, type, status, startDate, endDate, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = supabase
            .from('transactions')
            .select('*', { count: 'exact' });
        
        if (userId) query = query.eq('user_id', userId);
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
        
        res.json({
            success: true,
            transactions: transactions || [],
            total: count || 0,
            current_page: parseInt(page),
            total_pages: Math.ceil((count || 0) / limit)
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo transacciones:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log('===========================================');
    console.log('🚀 CROMWELL PAY - SISTEMA SEGURO INICIADO');
    console.log('===========================================');
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📁 Archivos: ${path.join(__dirname, 'public')}`);
    console.log(`🔐 Admin: Ersatz`);
    console.log('');
    console.log('✅ ENDPOINTS PÚBLICOS:');
    console.log('   GET  /api/status');
    console.log('   POST /api/register');
    console.log('   POST /api/login');
    console.log('');
    console.log('✅ ENDPOINTS USUARIOS (autenticados):');
    console.log('   GET  /api/verify-token');
    console.log('   GET  /api/dashboard');
    console.log('   GET  /api/user/profile');
    console.log('   PUT  /api/user/profile');
    console.log('   GET  /api/user/balance');
    console.log('   POST /api/user/change-password');
    console.log('   POST /api/logout');
    console.log('');
    console.log('🔐 ENDPOINTS ADMIN (SOLO Ersatz):');
    console.log('   GET  /api/admin/users');
    console.log('   GET  /api/admin/users/:userId');
    console.log('   PUT  /api/admin/users/:userId/balance');
    console.log('   GET  /api/transactions');
    console.log('');
    console.log('⚡ SISTEMA LISTO');
    console.log('===========================================');
});
