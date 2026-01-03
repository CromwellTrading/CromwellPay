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

// Supabase Client (con auth) - DESACTIVAR EMAILS AUTOMÁTICOS
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // DESACTIVAR EMAILS DE SUPABASE
        disableSignup: false,
        flowType: 'implicit'
    }
});

// ========== FUNCIONES AUXILIARES ==========

function generarCodigoVerificacion() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function tablaExiste(nombreTabla) {
    try {
        const { error } = await supabase
            .from(nombreTabla)
            .select('*')
            .limit(1);
        return !error;
    } catch (e) {
        return false;
    }
}

// ========== RUTAS DE AUTH ==========

// 1. Estado del servidor
app.get('/api/status', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.getUser();
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        
        res.json({ 
            success: true, 
            status: '✅ Cromwell Pay - EmailJS ONLY',
            auth: 'Supabase conectado (emails DESACTIVADOS)',
            tabla_codigos: tablaCodigosExiste ? '✅ Existe' : '❌ No existe',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 2. REGISTRO - SIN EMAIL AUTOMÁTICO DE SUPABASE
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, termsAccepted } = req.body;
        
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
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userExists = users.find(u => u.email === email.toLowerCase());
        
        if (userExists) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está registrado' 
            });
        }
        
        // Verificar tabla de códigos
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        if (!tablaCodigosExiste) {
            return res.status(500).json({ 
                success: false, 
                message: 'Sistema de verificación no configurado',
                instruction: 'CREATE TABLE email_verification_codes en Supabase SQL Editor'
            });
        }
        
        // Crear usuario SIN verificación automática
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email.toLowerCase(),
            password: password,
            email_confirm: false, // NO confirmar email automáticamente
            user_metadata: {
                nickname: email.split('@')[0],
                user_id: 'CROM-' + Date.now().toString().slice(-6),
                cwt: 0,
                cws: 0,
                role: 'user',
                phone: '',
                province: '',
                wallet: '',
                notifications: true,
                email_verified: false
            }
        });
        
        if (authError) {
            console.error('❌ Error creando usuario:', authError.message);
            return res.status(400).json({ 
                success: false, 
                message: authError.message 
            });
        }
        
        // Generar código de verificación
        const verificationCode = generarCodigoVerificacion();
        
        // Guardar código en la base de datos
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);
        
        const { error: dbError } = await supabase
            .from('email_verification_codes')
            .insert([
                {
                    email: email.toLowerCase(),
                    code: verificationCode,
                    expires_at: expiresAt.toISOString(),
                    used: false
                }
            ]);
        
        if (dbError) {
            console.error('❌ Error guardando código:', dbError);
            // Intentar eliminar usuario si falla
            if (authData.user?.id) {
                await supabase.auth.admin.deleteUser(authData.user.id);
            }
            return res.status(500).json({ 
                success: false, 
                message: 'Error al generar código de verificación' 
            });
        }
        
        console.log(`✅ Usuario registrado: ${email}`);
        console.log(`📧 Código generado para EmailJS: ${verificationCode}`);
        
        res.json({
            success: true,
            message: 'Registro exitoso. Redirigiendo a verificación...',
            email: email,
            code: verificationCode, // Para que el frontend lo envíe con EmailJS
            needsVerification: true,
            user: {
                id: authData.user?.id,
                email: authData.user?.email,
                user_id: authData.user?.user_metadata?.user_id
            },
            note: 'El frontend ENVIARÁ el código con EmailJS'
        });
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 3. LOGIN - Solo usuarios verificados
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        // Intentar login
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
                    message: 'Por favor verifica tu email primero',
                    email: email
                });
            }
            
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciales incorrectas' 
            });
        }
        
        // Verificar si el email está confirmado
        if (!data.user?.user_metadata?.email_verified) {
            return res.json({
                success: false,
                needsVerification: true,
                message: 'Por favor verifica tu email primero',
                email: email
            });
        }
        
        // ÉXITO
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso',
            token: data.session.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                user_id: data.user.user_metadata?.user_id,
                nickname: data.user.user_metadata?.nickname || email.split('@')[0],
                role: data.user.user_metadata?.role || 'user',
                verified: true,
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

// 4. VERIFICAR CÓDIGO
app.post('/api/verify-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email y código son requeridos' 
            });
        }
        
        // Buscar código válido
        const { data: codes, error: fetchError } = await supabase
            .from('email_verification_codes')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .limit(1);
        
        if (fetchError || !codes || codes.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código inválido o expirado' 
            });
        }
        
        // Marcar código como usado
        await supabase
            .from('email_verification_codes')
            .update({ used: true })
            .eq('id', codes[0].id);
        
        // Buscar usuario
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const targetUser = users.find(u => u.email === email.toLowerCase());
        
        if (!targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar usuario como verificado
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
        
        res.json({
            success: true,
            message: '¡Email verificado exitosamente!',
            email: email,
            verified: true
        });
        
    } catch (error) {
        console.error('❌ Error verificando código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 5. REENVIAR CÓDIGO
app.post('/api/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email es requerido' 
            });
        }
        
        // Verificar usuario
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const targetUser = users.find(u => u.email === email.toLowerCase());
        
        if (!targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        if (targetUser.user_metadata?.email_verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'El email ya está verificado' 
            });
        }
        
        // Marcar códigos anteriores como expirados
        await supabase
            .from('email_verification_codes')
            .update({ used: true })
            .eq('email', email.toLowerCase())
            .eq('used', false);
        
        // Generar nuevo código
        const verificationCode = generarCodigoVerificacion();
        
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);
        
        // Guardar nuevo código
        const { error: dbError } = await supabase
            .from('email_verification_codes')
            .insert([
                {
                    email: email.toLowerCase(),
                    code: verificationCode,
                    expires_at: expiresAt.toISOString(),
                    used: false
                }
            ]);
        
        if (dbError) {
            throw dbError;
        }
        
        res.json({
            success: true,
            message: 'Nuevo código generado',
            email: email,
            code: verificationCode // Para que el frontend lo envíe con EmailJS
        });
        
    } catch (error) {
        console.error('❌ Error reenviando código:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 6. VERIFICAR TOKEN
app.get('/api/verify-token', async (req, res) => {
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

// 7. DASHBOARD
app.get('/api/dashboard', async (req, res) => {
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
        console.error('❌ Error dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 8. ACTUALIZAR PERFIL
app.put('/api/user/profile', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token requerido' 
            });
        }
        
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        
        if (userError || !user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token inválido' 
            });
        }
        
        const { nickname, phone, province, wallet, notifications } = req.body;
        
        if (!nickname || !phone || !province) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nickname, teléfono y provincia son requeridos' 
            });
        }
        
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
        console.error('❌ Error actualizando perfil:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 9. LOGOUT
app.post('/api/logout', async (req, res) => {
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

// 10. OBTENER TODOS LOS USUARIOS (admin)
app.get('/api/admin/users', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token requerido' 
            });
        }
        
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (!user || user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado' 
            });
        }
        
        const { data: { users }, error } = await supabase.auth.admin.listUsers();
        
        if (error) {
            throw error;
        }
        
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
        console.error('❌ Error obteniendo usuarios:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// 11. ACTUALIZAR SALDO (admin)
app.put('/api/admin/users/:userId/balance', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token requerido' 
            });
        }
        
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (!user || user.user_metadata?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Acceso denegado' 
            });
        }
        
        const { userId } = req.params;
        const { cwt, cws, note } = req.body;
        
        if (cwt < 0 || cws < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Los balances no pueden ser negativos' 
            });
        }
        
        // Obtener usuario actual
        const { data: { user: targetUser }, error: userError } = await supabase.auth.admin.getUserById(userId);
        
        if (userError || !targetUser) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuario no encontrado' 
            });
        }
        
        // Actualizar metadata
        const { error } = await supabase.auth.admin.updateUserById(
            userId,
            {
                user_metadata: {
                    ...targetUser.user_metadata,
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
        console.error('❌ Error actualizando balance:', error);
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

// Ruta para verificar estado
app.get('/api/check-tables', async (req, res) => {
    try {
        const tablaCodigosExiste = await tablaExiste('email_verification_codes');
        
        res.json({
            success: true,
            tables: {
                email_verification_codes: tablaCodigosExiste
            },
            instructions: !tablaCodigosExiste ? 'CREATE TABLE email_verification_codes en Supabase SQL Editor' : 'Tabla existe'
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// SQL para crear tabla
app.get('/api/create-tables-sql', (req, res) => {
    const sql = `
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email 
ON email_verification_codes(email);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_active 
ON email_verification_codes(email, used, expires_at) 
WHERE used = false AND expires_at > NOW();
    `;
    
    res.json({
        success: true,
        sql: sql
    });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, async () => {
    console.log(`🚀 Cromwell Pay ejecutándose en http://localhost:${PORT}`);
    console.log(`🔗 Supabase: ${supabaseUrl}`);
    
    console.log('\n🔍 Verificando configuración...');
    const tablaCodigosExiste = await tablaExiste('email_verification_codes');
    
    if (tablaCodigosExiste) {
        console.log('✅ Tabla email_verification_codes: EXISTE');
        console.log('\n📧 SISTEMA DE VERIFICACIÓN:');
        console.log('   • EmailJS: ENVÍA los emails (frontend)');
        console.log('   • Supabase: NO envía emails (desactivado)');
        console.log('   • Backend: Solo genera y verifica códigos');
    } else {
        console.log('❌ Tabla email_verification_codes: NO EXISTE');
        console.log('\n📋 CREAR TABLA:');
        console.log('1. Ve a Supabase -> SQL Editor');
        console.log(`2. Visita http://localhost:${PORT}/api/create-tables-sql`);
        console.log('3. Copia el SQL y ejecútalo');
        console.log('4. Reinicia el servidor');
    }
    
    console.log('\n✅ SISTEMA LISTO - EMAILJS SOLO:');
    console.log('   • Registro: Genera código, frontend envía email');
    console.log('   • Login: Solo usuarios verificados');
    console.log('   • Verificación: Códigos de 6 dígitos');
    console.log('\n⚠️  CONFIGURACIÓN SUPABASE IMPORTANTE:');
    console.log('   • Desactiva "Confirm email" en Authentication');
    console.log('   • Desactiva todos los email templates');
});
