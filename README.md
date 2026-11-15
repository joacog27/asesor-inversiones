# Mi Asesor de Inversiones 🧭

Web app (PWA) para invertir mes a mes parte del sueldo según tu perfil, pensada para Argentina.
Funciona en la compu y en el celular, se instala como una app y **no usa nada pago**.

## Qué hace

| Sección | Qué vas a ver |
|---|---|
| **Test de perfil** | 10 preguntas → perfil (muy conservador a muy agresivo) con explicación. Se puede rehacer. |
| **Asesor** | Distribución objetivo, **plan del mes** con instrumentos concretos y cantidades a precio actual, novedades generadas por reglas (dólar, inflación vs tasas, brecha, riesgo país, desvíos de tu cartera, movimientos fuertes), glosario. Botón **“Ya lo compré”** que carga el plan a tu cartera. |
| **Mercado** | Elegís qué ver: dólares, indicadores, CEDEARs, acciones, bonos, letras, ONs, EE.UU., cripto. Tarjetas con variación y mini-gráfico, **mapa de calor**, gráfico detallado por activo (1S a 5A), tu propia lista. |
| **Mi cartera** | Cargás compras/ventas (acciones, CEDEARs, bonos, LECAPs, ONs, cripto, FCI, dólares, plazos fijos u otros). Valor actual, invertido, ganancia (también "real" descontando inflación), variación del día, composición, evolución en el tiempo vs lo invertido. Todo editable. |
| **Metas** 🆕 | Metas con nombre (casa, viaje, retiro…), monto, fecha y % de tu cartera asignado. Barra de progreso, cuánto tenés que aportar por mes para llegar, en cuánto llegás al ritmo actual y **probabilidad estimada** de lograrlo. |
| **Simulador** 🆕 | 1.000 escenarios del mercado (Monte Carlo): pesimista / base / optimista en plata de hoy, gráfico con el rango, chance de terminar con menos de lo que pusiste y **comparación entre perfiles**. |
| **Rebalanceo** 🆕 | En Mi cartera: qué clases se desviaron de tu objetivo y cuánto comprar/vender; sugiere hacerlo con los aportes (sin vender). Respeta tu fondo de emergencia. |
| **Alertas y recordatorios** 🆕 | Alertas de precio ("avisame si SPY baja de X", "si BTC se mueve ±5% en el día") con notificación. Recordatorio mensual del aporte (notificación + archivo **.ics** para tu calendario, que funciona aunque la app esté cerrada). |
| **Sincronización** 🆕 | Mismos datos en celular y compu, gratis, con tu cuenta de Google (Firebase). Funciona offline y sincroniza al volver la conexión. |
| **Ajustes** | Varios usuarios en el mismo dispositivo (vos y tu novia), ARS/USD, dólar para convertir (MEP, CCL, oficial, blue, cripto), tema claro/oscuro, recordatorio, alertas, sincronización, exportar/importar. |

### Fuentes de datos (gratis, sin registro ni API key)

| Dato | Fuente | Frecuencia |
|---|---|---|
| Dólar oficial/MEP/CCL/blue/cripto | [dolarapi.com](https://dolarapi.com) | cada 2 min |
| Acciones, CEDEARs, bonos, letras, ONs, acciones EE.UU. + históricos | [data912.com](https://data912.com) (BYMA, ~20 s de demora) | cada 1 min |
| Cripto + históricos | Binance público (`data-api.binance.vision`), respaldo CoinGecko | cada 15 s |
| Inflación, riesgo país, plazo fijo, FCI, dólar histórico | [ArgentinaDatos](https://argentinadatos.com) | cada 30 min |

Si una fuente falla, la app muestra el último dato guardado (con aviso) y sigue funcionando. Las actualizaciones se pausan cuando la pestaña no está visible.

> ⚠️ data912 es un proyecto personal gratuito: si algún día deja de funcionar, hay que cambiar el adaptador en `js/data.js`.

---

## Cómo publicarla gratis (GitHub Pages) — paso a paso

1. Creá una cuenta en [github.com](https://github.com) (gratis).
2. Arriba a la derecha: **＋ → New repository**. Nombre: `asesor-inversiones`. Dejalo **Public** (Pages gratis lo requiere) y tocá **Create repository**.
3. En la página del repo nuevo tocá **“uploading an existing file”** y arrastrá **todo el contenido** de esta carpeta (`index.html`, `sw.js`, `manifest.webmanifest` y las carpetas `css`, `js`, `icons`, `vendor`). Tocá **Commit changes**.
4. Andá a **Settings → Pages**. En *Source* elegí **Deploy from a branch**, branch **main**, carpeta **/ (root)** → **Save**.
5. En 1–2 minutos aparece el link: `https://TU-USUARIO.github.io/asesor-inversiones/`.

> Tus datos **no** se suben a GitHub: quedan guardados en el navegador de cada dispositivo. El repo solo tiene el código.
>
> Alternativa: [Cloudflare Pages](https://pages.cloudflare.com) o [Netlify Drop](https://app.netlify.com/drop) (arrastrás la carpeta y listo), ambos gratis.

## Instalarla como app

- **Android (Chrome):** abrí el link → menú ⋮ → **Instalar app** / *Agregar a pantalla principal*.
- **iPhone (Safari):** abrí el link → botón compartir ⬆ → **Agregar a pantalla de inicio**.
- **Compu (Chrome/Edge):** abrí el link → ícono de instalar en la barra de direcciones (⊕).

## Usarla entre celular y compu, y con tu novia

- **Cada persona:** en *Ajustes → Usuarios* (o tocando tu inicial arriba a la derecha) agregás otro usuario. Cada uno tiene su propio test, plan, metas y cartera.
- **Sincronización automática (recomendado):** configurá Firebase una vez (abajo) e iniciá sesión con Google en cada dispositivo.
  - Si usan **la misma cuenta de Google**, los dos ven ambos perfiles en todos los dispositivos.
  - Si cada uno usa **su propia cuenta**, cada cuenta guarda solo lo suyo.
- **A mano (sin Firebase):** *Ajustes → Exportar mis datos* → mandate el `.json` → en el otro dispositivo *Importar archivo* (fusiona sin duplicar).

## Sincronización gratis con Firebase — paso a paso (una sola vez, ~10 min)

El plan **Spark** de Firebase es gratis y no pide tarjeta. Sobra para uso personal (50.000 lecturas y 20.000 escrituras por día).

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) con tu cuenta de Google → **Crear un proyecto** (ej: `mi-asesor`). Podés desactivar Google Analytics.
2. **Authentication** → *Comenzar* → pestaña **Sign-in method** → **Google** → *Habilitar* → elegí tu mail de soporte → *Guardar*.
3. En **Authentication → Settings → Authorized domains** → *Add domain* → agregá el dominio donde publicaste la app (ej: `tu-usuario.github.io`). `localhost` ya viene incluido.
4. **Firestore Database** → *Crear base de datos* → ubicación `southamerica-east1` (San Pablo) → modo **producción**.
5. En Firestore → pestaña **Reglas**, reemplazá todo por esto y tocá *Publicar* (cada cuenta solo puede leer/escribir sus propios datos):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /asesor/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

6. ⚙️ **Configuración del proyecto** → *Tus apps* → ícono **</>** (Web) → nombre `asesor` → *Registrar app*. Copiá el bloque `const firebaseConfig = { ... }`.
7. Pegalo en **una** de estas dos formas:
   - **Recomendado:** en `js/config.js`, reemplazá `export const FIREBASE_CONFIG = null;` por `export const FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };` y volvé a subir ese archivo a GitHub. Así todos tus dispositivos ya lo tienen.
   - O en la app: *Ajustes → Sincronización* → pegar → *Guardar y conectar* (hay que hacerlo en cada dispositivo).
8. Tocá **Iniciar sesión con Google**. En un dispositivo nuevo, desde la pantalla de bienvenida: **☁️ Traer mis datos de la nube**.

> La `firebaseConfig` **no es secreta** (va en cualquier app web); lo que protege tus datos son las reglas del paso 5.
>
> **iPhone:** si instalaste la app en la pantalla de inicio y el login con Google no abre, iniciá sesión una vez desde Safari.

**Cómo se combinan los datos:** cada operación tiene marca de hora. Si cargás cosas en el celular y en la compu, se suman. Si editás la misma operación en los dos, gana la última edición. Los borrados se respetan en todos los dispositivos.

## Alertas y recordatorios: qué esperar

Sin un servidor (para que sea gratis), las **alertas de precio** y la **notificación del recordatorio** se revisan mientras la app está abierta (en la compu podés dejarla en una pestaña; en el celular, cuando la abrís). Para un aviso **garantizado** cada mes aunque no abras la app, usá *Ajustes → Recordatorio → Agregar a mi calendario (.ics)*: queda como evento mensual en Google Calendar / iPhone.

## Probarla en tu compu sin publicarla

Necesitás un servidor local (abrir `index.html` con doble clic no alcanza por los módulos JS). Con Python instalado, desde esta carpeta:

```bash
python3 -m http.server 8080
```

y abrí http://localhost:8080.

## Personalizar las reglas

Todo lo opinable está en **`js/config.js`**:

- `PROFILES`: % por clase de activo para cada perfil.
- `QUIZ`: preguntas, puntos y topes (ej: si vendés todo ante una caída, el perfil máximo es conservador).
- `PICKS`: instrumentos sugeridos por clase (ej: cambiar SPY por otro CEDEAR, sumar acciones).
- `RULES`: umbrales de alertas (desvío para rebalancear, movimientos fuertes, brecha, riesgo país, % del aporte al fondo de emergencia).
- `DEFAULT_WATCH`: qué activos aparecen en Mercado al empezar.
- `CLASS_RETURNS`: rendimiento real esperado y volatilidad de cada clase (usado por el simulador y las metas).
- `FIREBASE_CONFIG`: configuración de la sincronización.

El motor (`js/advisor.js`) además ajusta solo según el mercado:
- Inflación subiendo → más bono CER; bajando → más LECAP a tasa fija.
- Riesgo país alto → más ONs que bonos soberanos.
- LECAP: elige la más operada con vencimiento a más de 60 días.
- Plan del mes: el aporte va primero a las clases que quedaron por debajo del objetivo (rebalanceo sin vender) y, si el monto no alcanza para 1 unidad de algo, lo concentra o lo deja en money market.

## Estructura

```
index.html              página + layout
manifest.webmanifest    datos de la app instalable
sw.js                   service worker (funciona offline)
css/styles.css          estilos (claro/oscuro, celular/compu)
js/config.js            ⚙️ perfiles, test, instrumentos, reglas
js/advisor.js           motor de reglas del asesor
js/portfolio.js         cálculos de cartera (costo, ganancia, evolución)
js/data.js              adaptadores de datos + caché + actualización
js/symbols.js           utilidades de tickers
js/storage.js           usuarios, export/import, caché IndexedDB
js/simulator.js         Monte Carlo, metas, aporte necesario
js/notify.js            alertas, recordatorio, notificaciones, .ics
js/sync.js              login con Google + Firestore
js/sync-engine.js       motor de sincronización (independiente del proveedor)
js/sync-merge.js        fusión de datos entre dispositivos
js/ui.js                formato, modales, gráficos
js/app.js               arranque y navegación
js/views/*.js           pantallas
tests/*.test.js         tests (31)
vendor/chart.umd.min.js Chart.js 4.4.7 (local, para offline)
vendor/firebase-13.1.0.bundle.js  Firebase (auth + firestore), se carga solo si activás la sincronización
```

Tests (necesitan Node 18+):

```bash
node --test tests/*.test.js
```

## Próximas ideas

- TIR y flujo de pagos de bonos, cupones y dividendos en la cartera.
- Comparar tu rendimiento contra un benchmark (S&P 500, inflación, plazo fijo).
- Importar operaciones desde el resumen del broker (CSV).

---

**Aviso:** herramienta educativa y orientativa. No constituye asesoramiento financiero profesional ni recomendación de compra/venta. Consultá con un asesor matriculado (ALyC/CNV) antes de tomar decisiones importantes.
