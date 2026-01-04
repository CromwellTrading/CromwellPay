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
app.use(express.static(path.join(__dirname, 'public')));

// Redirecciones
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/login', (req, res) => res.redirect('/login.html'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/register', (req, res) => res.redirect('/register.html'));

// ========== SUPABASE ==========
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERROR: Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ========== FUNCIONES ==========
function generarIDUsuario() {
    return `CROM-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

// ========== MIDDLEWARE ==========
const authenticateToken = async (req, res, next) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token requerido' 
            });
        }
        
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
        console.error('Error autenticación:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error de autenticación' 
        });
    }
};

const requireAdmin = async (req, res, next) => {
    try {
        const user = req.user;
        
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
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso solo para administrador principal' 
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
app.get('/api/status', async (req, res) => {
    res.json({ 
        success: true, 
        status: '✅ Cromwell Pay Funcionando',
        timestamp: new Date().toISOString(),
        version: '3.1.0',
        auth: 'nickname_only',
        admin: 'Ersatz'
    });
});

// REGISTRO - VERSIÓN SIMPLIFICADA Y FUNCIONAL
app.post('/api/register', async (req, res) => {
    try {
        const { nickname, password, termsAccepted } = req.body;
        
        if (!nickname || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname y contraseña requeridos' 
            });
        }
        
        if (!termsAccepted) {
            return res.status(400).json({ 
                success: false, 
                message: 'Acepta los términos' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Contraseña mínimo 6 caracteres' 
            });
        }
        
        // Verificar nickname único
        const { data: existingProfile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('nickname', nickname)
            .single();
        
        if (existingProfile) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname ya existe' 
            });
        }
        
        // Crear email único
        const uniqueEmail = `${nickname.toLowerCase()}_${Date.now()}@cromwellpay.local`;
        const userId = generarIDUsuario();
        
        console.log(`📝 Creando usuario: ${nickname}`);
        
        // Crear usuario en auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: uniqueEmail,
            password: password,
            email_confirm: true,
            user_metadata: {
                nickname: nickname,
                user_id: userId,
                role: 'user'
            }
        });
        
        if (authError) {
            console.error('Error auth.createUser:', authError.message);
            return res.status(400).json({ 
                success: false, 
                message: authError.message 
            });
        }
        
        // Crear perfil en profiles
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
            console.error('Error profiles.insert:', profileError.message);
            // Intentar limpiar
            await supabase.auth.admin.deleteUser(authData.user.id);
            return res.status(400).json({ 
                success: false, 
                message: 'Error creando perfil' 
            });
        }
        
        // Crear sesión automática
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
            user_id: authData.user.id
        });
        
        console.log(`✅ Usuario creado: ${nickname}`);
        
        res.json({
            success: true,
            message: 'Registro exitoso',
            nickname: nickname,
            token: sessionData?.session?.access_token || null,
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
        console.error('Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

// LOGIN - VERSIÓN SIMPLIFICADA
app.post('/api/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        
        if (!nickname || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname y contraseña requeridos' 
            });
        }
        
        console.log(`🔍 Login: ${nickname}`);
        
        // Buscar perfil
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('nickname', nickname)
            .single();
        
        if (profileError || !profile) {
            console.log(`❌ No encontrado: ${nickname}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        // Obtener usuario auth por ID
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const authUser = users.find(u => u.id === profile.id);
        
        if (!authUser) {
            console.error(`❌ Auth no encontrado: ${profile.id}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        // Intentar login
        const { data, error } = await supabase.auth.signInWithPassword({
            email: authUser.email,
            password: password
        });
        
        if (error) {
            console.error(`❌ Login fallido: ${error.message}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        console.log(`✅ Login exitoso: ${nickname}`);
        
        res.json({
            success: true,
            message: 'Login exitoso',
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
        console.error('Error en login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

// ========== RUTAS PROTEGIDAS ==========
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
        console.error('Error verificando token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

app.get('/api/dashboard', authenticateToken, async (req, res) => {
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
            user: profile,
            dashboard: {
                total_balance: (profile.cwt || 0) + (profile.cws || 0),
                total_cwt: profile.cwt,
                total_cws: profile.cws
            }
        });
        
    } catch (error) {
        console.error('Error dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

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
            profile: profile
        });
        
    } catch (error) {
        console.error('Error perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { nickname, phone, province, wallet_address, notifications } = req.body;
        
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Datos requeridos' 
            });
        }
        
        // Verificar nickname único
        if (nickname !== user.user_metadata?.nickname) {
            const { data: existing } = await supabase
                .from('profiles')
                .select('id')
                .eq('nickname', nickname)
                .neq('id', user.id)
                .single();
            
            if (existing) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Nickname ya en uso' 
                });
            }
        }
        
        const { error } = await supabase
            .from('profiles')
            .update({
                nickname: nickname,
                phone: phone,
                province: province,
                wallet_address: wallet_address || '',
                notifications: notifications !== false
            })
            .eq('id', user.id);
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Perfil actualizado'
        });
        
    } catch (error) {
        console.error('Error actualizando perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

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
                total: (profile.cwt || 0) + (profile.cws || 0)
            }
        });
        
    } catch (error) {
        console.error('Error balance:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

// ========== RUTAS ADMIN ==========
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        res.json({
            success: true,
            users: users || []
        });
        
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

app.put('/api/admin/users/:userId/balance', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { cwt, cws, operation, reason } = req.body;
        
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
        
        let newCWT = targetUser.cwt || 0;
        let newCWS = targetUser.cws || 0;
        
        if (operation === 'add') {
            newCWT += parseFloat(cwt) || 0;
            newCWS += parseInt(cws) || 0;
        } else if (operation === 'subtract') {
            newCWT = Math.max(newCWT - (parseFloat(cwt) || 0), 0);
            newCWS = Math.max(newCWS - (parseInt(cws) || 0), 0);
        }
        
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                cwt: newCWT,
                cws: newCWS
            })
            .eq('id', userId);
        
        if (updateError) throw updateError;
        
        res.json({
            success: true,
            message: 'Balance actualizado',
            user: {
                id: targetUser.id,
                nickname: targetUser.nickname,
                balance: {
                    previous: { cwt: targetUser.cwt || 0, cws: targetUser.cws || 0 },
                    current: { cwt: newCWT, cws: newCWS }
                }
            }
        });
        
    } catch (error) {
        console.error('Error actualizando balance:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno' 
        });
    }
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
    console.log('===========================================');
    console.log(`🚀 Cromwell Pay en http://localhost:${PORT}`);
    console.log('✅ RLS: DESHABILITADO (sin bloqueos)');
    console.log('🔐 Admin: Ersatz / ErsatzCromwell*320()/#');
    console.log('===========================================');
});
