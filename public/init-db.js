const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function initDatabase() {
    console.log('🔧 Inicializando base de datos Cromwell Pay...');
    
    try {
        // Verificar si ya existe admin
        const { data: existingAdmin } = await supabase
            .from('users')
            .select('*')
            .eq('email', process.env.ADMIN_EMAIL)
            .single();
            
        if (existingAdmin) {
            console.log('✅ Base de datos ya inicializada');
            return;
        }
        
        // Crear admin
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        
        const adminUser = {
            user_id: 'CROM-0001',
            email: process.env.ADMIN_EMAIL,
            password_hash: hashedPassword,
            verified: true,
            role: 'admin',
            cwt: 25.5,
            cws: 1250,
            nickname: 'Administrador Cromwell',
            phone: '+53 5555 5555',
            province: 'La Habana',
            wallet: '',
            notifications: true,
            last_activity: new Date().toISOString(),
            joined_at: new Date().toISOString(),
            accepted_terms: true
        };
        
        const { data, error } = await supabase
            .from('users')
            .insert([adminUser])
            .select()
            .single();
            
        if (error) throw error;
        
        console.log('✅ Base de datos inicializada exitosamente');
        console.log('👤 Usuario admin creado:');
        console.log(`   Email: ${process.env.ADMIN_EMAIL}`);
        console.log(`   Contraseña: ${process.env.ADMIN_PASSWORD}`);
        console.log(`   ID: CROM-0001`);
        
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error.message);
        process.exit(1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    initDatabase();
}

module.exports = { initDatabase };
