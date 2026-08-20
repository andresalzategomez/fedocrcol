# OCR Liga Hub

PROMPT COMPLETO PARA LOVABLE (ACTUALIZADO CON TEMPLATE BASE, PAGOS Y SUPABASE EXTERNO):

1. Visión General del Proyecto

Desarrolla un software como servicio (SaaS) multitenant en Angular para la Federación/Liga Principal de OCR en Colombia. La plataforma centraliza la administración de ligas departamentales, la gestión e inscripción paga a carreras, el registro unificado de atletas y las tablas de posiciones. 

IMPORTANTE: El backend utilizará una instancia externa y propia de Supabase.

2. Template Base y Adaptación de Interfaz

- REQUISITO DE DISEÑO: La aplicación debe heredar la interfaz gráfica, estructura de componentes y layout del siguiente template: https://lovable.dev/es/templates/websites/services/tailwaggers-multi-location-pet-care-franchise-hub-template

- Adaptación Temática: Toma la lógica de "franquicia multisede" (multi-location) del template y adáptala a un contexto de "federación multiligas" (multi-tenant) de un deporte extremo (OCR). 

- El selector de ubicaciones del template debe transformarse en el "Selector de Ligas Departamentales", y las páginas específicas de cada sede deben ser las páginas personalizadas de cada liga.

3. Backend y Base de Datos (Supabase Externo de Andrés)

- RESTRICCIÓN CRÍTICA: NO utilices Lovable Cloud ni la integración nativa de Supabase de Lovable para crear el backend.

- Conexión: La aplicación Angular debe conectarse a un proyecto de Supabase externo (el de Andrés) utilizando exclusivamente variables de entorno (`SUPABASE_URL` y `SUPABASE_ANON_KEY`).

- Autenticación: Implementar Supabase Auth para la gestión de usuarios (Super Admin, Admin de Liga, Atleta) usando el cliente de Supabase JS.

- Migraciones: Genera el archivo `schema.sql` con todas las tablas, políticas de seguridad (RLS) y roles necesarios, para que se pueda ejecutar manualmente en el panel de Supabase externo.

4. Roles y Permisos (Arquitectura Multi-Tenant usando RLS en Supabase)

- Super Admin (Administración Nacional):

  * Crear, habilitar y suspender ligas regionales (tenants).

  * Configurar comisiones y visualizar un dashboard global de ingresos.

- Admin de Liga (Tenant Admin):

  * Personalizar la identidad visual de su liga (branding white-label).

  * Crear eventos/carreras locales con precios y etapas de preventa.

  * Validar inscripciones y pagos (Acceso restringido por RLS solo a los datos de su tenant_id).

- Atleta:

  * Registro de perfil vinculado a una liga departamental.

  * Pago de inscripción a carreras, descarga de ticket QR y consulta de ranking.

5. Motor de Personalización Dinámica (White-Label)

- Campos configurables por tenant en Supabase: Nombre, Logo, Color primario, Color secundario, Banner.

- Implementación Angular: Un servicio 'ThemeService' que consulte el `tenant_id` e inyecte CSS Custom Properties (--primary-color, --secondary-color) en el DOM, sobrescribiendo los colores por defecto del template base para cada liga.

6. Módulo de Inscripción a Carreras y Pasarela de Pagos

- Flujo de Inscripción: Selección de carrera -> Validación de cupos -> Tarifa dinámica por fecha -> Redirección a pasarela.

- Integración de Pagos (Colombia):

  * Preparar el sistema para pasarelas locales (Wompi, PayU, Bold, Mercado Pago, PSE).

  * Webhooks: Crear un servicio (Edge Function o endpoint en Angular) para recibir el evento de confirmación de pago y actualizar el estado en la tabla `Registrations` de 'Pendiente' a 'Pagado'.

  * Generación de comprobante QR tras confirmación.

7. Motor de Puntuación y Clasificaciones al Mundial

- Puntuación Individual: Ranking acumulado anual con "Badge de Clasificado" al Mundial de OCR.

- Puntuación Interligas: Escalafón departamental sumando los mejores puntajes individuales.

- Diseño de tablas: Utilizar el estilo limpio y moderno de las tablas o listados de servicios del template base para mostrar estos rankings.

8. Estructura de Datos (Para el archivo schema.sql de Andrés)

- Tenants: id, name, slug, logo_url, primary_color, secondary_color, payment_keys, status.

- Profiles: id (uuid, refs auth.users), role (superadmin, admin, athlete), tenant_id, document_id, full_name, gender, birth_date.

- Events: id, tenant_id, title, date, location, max_capacity.

- EventCategories: id, event_id, name, price, slots_available.

- Registrations: id, event_id, athlete_id, category_id, status (pending, paid, cancelled), qr_code.

- Payments: id, registration_id, transaction_id, amount, method, status.

- Results: id, event_id, athlete_id, finish_time, position, points_awarded.

(Incluir políticas de Row Level Security - RLS para separar la data por tenant_id).

9. UI/UX Final

- Framework: Angular con Tailwind CSS (aprovechando las clases del template de Lovable).

- Formularios reactivos (Reactive Forms) con validaciones robustas.

- El panel de administración debe sentirse coherente con la paleta de colores y el layout general (sidebar, topbar, cards) del template proporcionado.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fedocrcol.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e3349e7a-384f-4065-9f06-60a6fb0ca9c6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
