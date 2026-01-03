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

// ========== INICIALIZACIÓN DE BASE DE DATOS ==========
const inicializarBaseDeDatos = async () => {
    try {
        console.log('🔧 Inicializando base de datos...');
        
        // 1. Tabla para códigos de verificación
        const { error: errorCodigos } = await supabase.rpc('crear_tabla_codigos', {});
        if (errorCodigos) {
            // Si la función no existe, crear tabla directamente
            const { error: createTableError } = await supabase
                .from('email_verification_codes')
                .select('*')
                .limit(1);
            
            if (createTableError && createTableError.code === '42P01') {
                // Tabla no existe, crear con SQL
                console.log('📁 Creando tabla email_verification_codes...');
                
                // Ejecutar SQL para crear tabla
                const { error: sqlError } = await supabase.rpc('exec_sql', {
                    sql_query: `
                        CREATE TABLE IF NOT EXISTS email_verification_codes (
                            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                            email TEXT NOT NULL,
                            code VARCHAR(6) NOT NULL,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '15 minutes'),
                            used BOOLEAN DEFAULT FALSE
                        );

                        CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email 
                        ON email_verification_codes(email);

                        CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires 
                        ON email_verification_codes(expires_at);
                    `
                });
                
                if (sqlError) {
                    console.log('⚠️ No se pudo ejecutar SQL, intentando método alternativo...');
                    // Método alternativo: intentar crear tabla insertando y eliminando
                    await supabase
                        .from('email_verification_codes')
                        .insert([{
                            email: 'test@test.com',
                            code: '000000'
                        }])
                        .then(() => {
                            supabase
                                .from('email_verification_codes')
                                .delete()
                                .eq('email', 'test@test.com');
                        });
                }
            }
        }
        
        // 2. Tabla para notificaciones (si existe)
        try {
            await supabase
                .from('notifications')
                .select('*')
                .limit(1);
        } catch (e) {
            console.log('⚠️ Tabla notifications no existe o no es necesaria');
        }
        
        // 3. Tabla para logs de auditoría (opcional)
        try {
            await supabase
                .from('audit_logs')
                .select('*')
                .limit(1);
        } catch (e) {
            console.log('⚠️ Tabla audit_logs no existe o no es necesaria');
        }
        
        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error.message);
    }
};

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

// ========== FUNCIONES AUXILIARES ==========

// Función para generar código de verificación
function generarCodigoVerificacion() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ========== RUTAS DE AUTH ==========

// 1. Estado del servidor
app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        status: '✅ Cromwell Pay con Sistema de Verificación por Email',
        auth: 'Sistema activado',
        timestamp: new Date().toISOString()
    });
});

// 2. REGISTRO con verificación por código
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
        
        // Verificar si el email ya existe
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const userExists = existingUsers.users.find(u => u.email === email.toLowerCase());
        
        if (userExists) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está registrado' 
            });
        }
        
        // Crear usuario en Supabase PERO sin verificación automática
        const { data: authData, error: authError } = await supabase.auth.signUp({
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
                    notifications: true,
                    email_verified: false // Marcamos que el email no está verificado
                }
                // IMPORTANTE: No configuramos emailRedirectTo para evitar el email automático
            }
        });
        
        if (authError) {
            console.error('❌ Error en registro Supabase:', authError.message);
            return res.status(400).json({ 
                success: false, 
                message: authError.message 
            });
        }
        
        // Generar código de verificación
        const verificationCode = generarCodigoVerificacion();
        
        // Guardar el código en la base de datos
        const { error: dbError } = await supabase
            .from('email_verification_codes')
            .insert([
                {
                    email: email.toLowerCase(),
                    code: verificationCode
                }
            ]);
        
        if (dbError) {
            console.error('❌ Error al guardar código:', dbError);
            // Intentar crear la tabla si no existe
            if (dbError.code === '42P01') {
                await inicializarBaseDeDatos();
                // Reintentar insertar
                const { error: retryError } = await supabase
                    .from('email_verification_codes')
                    .insert([
                        {
                            email: email.toLowerCase(),
                            code: verificationCode
                        }
                    ]);
                
                if (retryError) {
                    // Eliminar el usuario creado si falla
                    if (authData.user?.id) {
                        await supabase.auth.admin.deleteUser(authData.user.id);
                    }
                    throw retryError;
                }
            } else {
                // Eliminar el usuario creado si falla
                if (authData.user?.id) {
                    await supabase.auth.admin.deleteUser(authData.user.id);
                }
                throw dbError;
            }
        }
        
        // Enviar email usando EmailJS desde el frontend
        // El frontend se encargará de enviar el email
        console.log(`✅ Usuario registrado: ${email}`);
        console.log(`📧 Código generado: ${verificationCode}`);
        console.log('📤 Email será enviado desde el frontend usando EmailJS');
        
        res.json({
            success: true,
            message: 'Registro exitoso. Redirigiendo a verificación...',
            email: email,
            code: verificationCode, // Solo para desarrollo, en producción no enviar
            needsVerification: true,
            user: {
                id: authData.user?.id,
                email: authData.user?.email,
                user_id: authData.user?.user_metadata?.user_id
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

// 3. LOGIN con verificación de email
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        // Primero verificar si el usuario existe y si su email está verificado
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
        
        if (userError) {
            throw userError;
        }
        
        const targetUser = users.find(u => u.email === email.toLowerCase());
        
        if (targetUser && !targetUser.user_metadata?.email_verified) {
            return res.json({
                success: false,
                needsVerification: true,
                message: 'Por favor verifica tu email antes de iniciar sesión',
                email: email
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
        
        // Verificar si el email está confirmado en los metadatos
        if (!data.user?.user_metadata?.email_verified) {
            return res.json({
                success: false,
                needsVerification: true,
                message: 'Por favor verifica tu email con el código que te enviamos',
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
                verified: !!data.user.user_metadata?.email_verified,
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

// 4. VERIFICAR CÓDIGO DE EMAIL
app.post('/api/verify-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y código son requeridos' 
            });
        }
        
        // Buscar el código en la base de datos
        const { data: codes, error: fetchError } = await supabase
            .from('email_verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .limit(1);
        
        if (fetchError) {
            // Si la tabla no existe, crearla
            if (fetchError.code === '42P01') {
                await inicializarBaseDeDatos();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Intenta verificar nuevamente. La base de datos se está inicializando.' 
                });
            }
            throw fetchError;
        }
        
        if (!codes || codes.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código inválido o expirado' 
            });
        }
        
        // Marcar el código como usado
        await supabase
            .from('email_verification_codes')
            .update({ used: true })
            .eq('id', codes[0].id);
        
        // Buscar el usuario en Supabase
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
        
        if (userError) {
            throw userError;
        }
        
        const targetUser = users.find(u => u.email === email.toLowerCase());
        
        if (!targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar el usuario para marcar el email como verificado
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            targetUser.id,
            {
                user_metadata: { 
                    ...targetUser.user_metadata,
                    email_verified: true,
                    email_verified_at: new Date().toISOString()
                }
            }
        );
        
        if (updateError) {
            throw updateError;
        }
        
        // Crear sesión para el usuario
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.createUser({
            email: email.toLowerCase(),
            email_confirm: true,
            user_metadata: {
                ...targetUser.user_metadata,
                email_verified: true
            }
        });
        
        res.json({
            success: true,
            message: '¡Email verificado exitosamente!',
            user: {
                id: targetUser.id,
                email: targetUser.email,
                user_id: targetUser.user_metadata?.user_id || 'CROM-' + targetUser.id.slice(0, 8),
                nickname: targetUser.user_metadata?.nickname || email.split('@')[0],
                verified: true
            }
        });
        
    } catch (error) {
        console.error('❌ Error al verificar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. REENVIAR código de verificación
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email es requerido' 
            });
        }
        
        // Verificar si el usuario existe
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
        
        if (userError) {
            throw userError;
        }
        
        const targetUser = users.find(u => u.email === email.toLowerCase());
        
        if (!targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Verificar si ya está verificado
        if (targetUser.user_metadata?.email_verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está verificado' 
            });
        }
        
        // Eliminar códigos antiguos
        await supabase
            .from('email_verification_codes')
            .delete()
            .eq('email', email.toLowerCase());
        
        // Generar nuevo código
        const verificationCode = generarCodigoVerificacion();
        
        // Guardar nuevo código
        const { error: dbError } = await supabase
            .from('email_verification_codes')
            .insert([
                {
                    email: email.toLowerCase(),
                    code: verificationCode
                }
            ]);
        
        if (dbError) {
            // Si la tabla no existe, crearla
            if (dbError.code === '42P01') {
                await inicializarBaseDeDatos();
                return res.json({
                    success: true,
                    message: 'Sistema de verificación inicializado. Por favor intenta nuevamente.'
                });
            }
            throw dbError;
        }
        
        res.json({
            success: true,
            message: 'Nuevo código generado. El frontend lo enviará por email.',
            email: email,
            code: verificationCode // Solo para desarrollo
        });
        
    } catch (error) {
        console.error('❌ Error al reenviar código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
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
                verified: !!user.user_metadata?.email_verified,
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
                verified: !!user.user_metadata?.email_verified,
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
                wallet: wallet || '',
                notifications: notifications !== false
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
        
        // Obtener todos los usuarios
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
            verified: !!user.user_metadata?.email_verified,
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
        
        // Registrar en logs de auditoría si existe la tabla
        try {
            await supabase
                .from('audit_logs')
                .insert([
                    {
                        user_id: userId,
                        admin_id: req.user.id,
                        action: 'UPDATE_BALANCE',
                        details: {
                            previous_cwt: user.user_metadata?.cwt || 0,
                            new_cwt: cwt,
                            previous_cws: user.user_metadata?.cws || 0,
                            new_cws: cws,
                            note: note
                        },
                        created_at: new Date().toISOString()
                    }
                ]);
        } catch (e) {
            // Tabla no existe, ignorar
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

// 12. OBTENER ESTADÍSTICAS (admin)
app.get('/api/admin/stats', verificarUsuarioSupabase, async (req, res) => {
    try {
        // Verificar que sea admin
        if (req.user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado' 
            });
        }
        
        // Obtener todos los usuarios
        const { data: { users }, error } = await supabase.auth.admin.listUsers();
        
        if (error) {
            throw error;
        }
        
        // Calcular estadísticas
        const totalUsers = users.length;
        const verifiedUsers = users.filter(u => u.user_metadata?.email_verified).length;
        const totalCWT = users.reduce((sum, user) => sum + (user.user_metadata?.cwt || 0), 0);
        const totalCWS = users.reduce((sum, user) => sum + (user.user_metadata?.cws || 0), 0);
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                verifiedUsers,
                unverifiedUsers: totalUsers - verifiedUsers,
                totalCWT: parseFloat(totalCWT.toFixed(2)),
                totalCWS,
                equivalentUSDT: parseFloat((totalCWT / 0.1 * 5).toFixed(2)),
                equivalentSaldo: parseFloat((totalCWS / 10 * 100).toFixed(0)),
                lastUpdated: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error al obtener estadísticas:', error);
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

app.get('/verify-email.html', (req, res) => {
    res.sendFile(__dirname + '/public/verify-email.html');
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, async () => {
    console.log(`🚀 Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`🔗 URL Supabase: ${supabaseUrl}`);
    
    // Inicializar base de datos
    await inicializarBaseDeDatos();
    
    console.log('\n✅ SISTEMA DE VERIFICACIÓN POR CÓDIGO:');
    console.log('   • Código de 6 dígitos enviado por EmailJS');
    console.log('   • Tablas creadas automáticamente si no existen');
    console.log('   • Verificación manual desde el frontend');
    console.log('   • Sin problemas con localhost');
});
