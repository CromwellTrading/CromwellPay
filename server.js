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

// ========== FUNCIONES AUXILIARES ==========

// Función para generar código de verificación
function generarCodigoVerificacion() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Función para verificar si una tabla existe
async function tablaExiste(nombreTabla) {
    try {
        // Intentar seleccionar un registro (si la tabla no existe, dará error)
        const { error } = await supabase
            .from(nombreTabla)
            .select('*')
            .limit(1);
        
        // Si no hay error, la tabla existe
        return !error;
    } catch (e) {
        return false;
    }
}

// ========== RUTAS DE AUTH ==========

// 1. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        // Verificar conexión con Supabase
        const { data, error } = await supabase.auth.getUser();
        
        // Verificar si existe la tabla de códigos
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        
        res.json({ 
            success: true, 
            status: '✅ Cromwell Pay con Sistema de Verificación',
            auth: 'Supabase conectado',
            tabla_codigos: tablaCodigosExiste ? '✅ Existe' : '❌ No existe - CREAR MANUALMENTE',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({ 
            success: false, 
            status: '⚠️ Error verificando estado',
            error: error.message 
        });
    }
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
        
        // Verificar si la tabla de códigos existe
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        if (!tablaCodigosExiste) {
            console.error('❌ Tabla email_verification_codes no existe');
            return res.status(500).json({ 
                success: false, 
                message: 'Error del sistema. La tabla de verificación no está configurada.',
                instrucciones: 'Por favor crea la tabla manualmente en Supabase con el SQL proporcionado.'
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
            
            // Eliminar el usuario creado si falla
            if (authData.user?.id) {
                await supabase.auth.admin.deleteUser(authData.user.id);
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Error al guardar el código de verificación',
                detalle: 'La tabla existe pero hubo un error al insertar'
            });
        }
        
        // Enviar respuesta exitosa
        console.log(`✅ Usuario registrado: ${email}`);
        console.log(`📧 Código generado: ${verificationCode}`);
        console.log('📤 Email será enviado desde el frontend usando EmailJS');
        
        res.json({
            success: true,
            message: 'Registro exitoso. Redirigiendo a verificación...',
            email: email,
            code: verificationCode, // Solo para desarrollo/testing
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
        
        // Primero intentar login normal
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password: password
        });
        
        if (error) {
            console.error('❌ Error en login:', error.message);
            
            // Verificar si el usuario existe pero no está verificado
            const { data: { users } } = await supabase.auth.admin.listUsers();
            const targetUser = users.find(u => u.email === email.toLowerCase());
            
            if (targetUser && !targetUser.user_metadata?.email_verified) {
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
        if (!data.user?.user_metadata?.email_verified) {
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
        
        // Verificar si la tabla existe
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        if (!tablaCodigosExiste) {
            return res.status(500).json({ 
                success: false, 
                message: 'Sistema de verificación no configurado correctamente' 
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
        
        // Crear una sesión para el usuario
        // Nota: Para esto necesitamos generar un token manualmente o hacer login
        const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password: 'temp_password' // Necesitas manejar esto diferente
        });
        
        // En lugar de lo anterior, retornaremos que fue exitoso y el frontend hará login
        res.json({
            success: true,
            message: '¡Email verificado exitosamente! Ahora puedes iniciar sesión.',
            email: email
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
        
        // Verificar si la tabla existe
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        if (!tablaCodigosExiste) {
            return res.status(500).json({ 
                success: false, 
                message: 'Sistema de verificación no configurado correctamente' 
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
            throw dbError;
        }
        
        res.json({
            success: true,
            message: 'Nuevo código generado. El frontend lo enviará por email.',
            email: email,
            code: verificationCode // Solo para desarrollo/testing
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

app.get('/verify-email.html', (req, res) => {
    res.sendFile(__dirname + '/public/verify-email.html');
});

// Ruta para verificar estado de la tabla
app.get('/api/check-tables', async (req, res) => {
    try {
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        const tablaNotificacionesExiste = await tablaExiste('notifications');
        const tablaAuditLogsExiste = await tablaExiste('audit_logs');
        
        res.json({
            success: true,
            tables: {
                email_verification_codes: tablaCodigosExiste,
                notifications: tablaNotificacionesExiste,
                audit_logs: tablaAuditLogsExiste
            },
            instructions: !tablaCodigosExiste ? 'CREATE TABLE email_verification_codes manually in Supabase SQL Editor' : 'All tables exist'
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, async () => {
    console.log(`🚀 Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`🔗 URL Supabase: ${supabaseUrl}`);
    
    // Verificar tablas
    console.log('\n🔍 Verificando tablas...');
    const tablaCodigosExiste = await tablaExiste('email_verification_codes');
    
    if (tablaCodigosExiste) {
        console.log('✅ Tabla email_verification_codes: EXISTE');
    } else {
        console.log('❌ Tabla email_verification_codes: NO EXISTE');
        console.log('\n📋 INSTRUCCIONES PARA CREAR LA TABLA:');
        console.log('1. Ve a Supabase Dashboard -> SQL Editor');
        console.log('2. Copia y pega el SQL de creación de tablas');
        console.log('3. Haz clic en "Run"');
        console.log('4. Reinicia este servidor');
    }
    
    console.log('\n✅ SISTEMA LISTO:');
    console.log('   • Verificación por código de 6 dígitos');
    console.log('   • EmailJS para envío de emails');
    console.log('   • Dashboard de administración');
});
