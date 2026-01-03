import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { Resend } from 'npm:resend@2.0.0'

const resend = new Resend(Deno.env.get('RESEND_API_KEY'))

serve(async (req) => {
  try {
    const { to, code } = await req.json()
    
    const { data, error } = await resend.emails.send({
      from: 'Cromwell Pay <verificacion@cromwellpay.com>',
      to: [to],
      subject: 'Código de Verificación',
      html: `<h1>Tu código: ${code}</h1>`
    })
    
    if (error) {
      return new Response(JSON.stringify({ error }), { status: 400 })
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    })
  }
})
