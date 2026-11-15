// =====================================================================
// CONFIGURACIÓN DEL ASESOR
// Todo lo "opinable" (perfiles, preguntas, asignaciones, instrumentos,
// umbrales de alertas) vive acá para que lo puedas editar fácil.
// =====================================================================

export const APP_VERSION = '2.0.0';

// ---------------------------------------------------------------------
// Clases de activo. El orden define el color (paleta categórica validada).
// ---------------------------------------------------------------------
export const CLASSES = {
  rv_global: {
    name: 'Renta variable global',
    short: 'Global (CEDEARs/ETFs)',
    slot: 1,
    risk: 4,
    desc: 'Acciones y ETFs de empresas de todo el mundo (por ejemplo el S&P 500) a través de CEDEARs. Siguen al dólar CCL y al mercado de EE.UU. Es el motor de crecimiento a largo plazo.',
  },
  rf_usd: {
    name: 'Renta fija en dólares',
    short: 'Bonos/ONs en USD',
    slot: 2,
    risk: 3,
    desc: 'Bonos soberanos (AL30, GD30…) y Obligaciones Negociables de empresas que pagan en dólares. Dan intereses en USD; el riesgo es que el emisor no pague (riesgo país).',
  },
  liquidez: {
    name: 'Liquidez',
    short: 'Liquidez',
    slot: 3,
    risk: 1,
    desc: 'Plata disponible en el día: FCI money market, cuenta remunerada, caución o dólares en efectivo. Sirve como fondo de emergencia y para aprovechar oportunidades.',
  },
  rf_ars: {
    name: 'Renta fija en pesos',
    short: 'Pesos (LECAPs/CER)',
    slot: 4,
    risk: 2,
    desc: 'Letras del Tesoro a tasa fija (LECAPs), bonos que ajustan por inflación (CER) y plazos fijos. Buscan ganarle a la inflación con poco riesgo, pero en pesos.',
  },
  rv_arg: {
    name: 'Acciones argentinas',
    short: 'Acciones AR',
    slot: 5,
    risk: 5,
    desc: 'Acciones de empresas argentinas (GGAL, YPF, PAMP…). Pueden subir mucho cuando le va bien al país, pero son muy volátiles.',
  },
  cripto: {
    name: 'Cripto',
    short: 'Cripto',
    slot: 6,
    risk: 5,
    desc: 'Bitcoin y Ethereum. Activos muy volátiles (pueden caer 50% o más); se recomienda una porción chica y a largo plazo.',
  },
};
export const CLASS_ORDER = ['rv_global', 'rf_usd', 'liquidez', 'rf_ars', 'rv_arg', 'cripto'];

// ---------------------------------------------------------------------
// Perfiles: asignación objetivo (% por clase, suma 100).
// ---------------------------------------------------------------------
export const PROFILES = [
  {
    id: 'muy_conservador', name: 'Muy conservador', emoji: '🛡️',
    desc: 'Priorizás no perder. Tu plan se enfoca en liquidez y renta fija, con muy poca exposición a acciones.',
    alloc: { liquidez: 40, rf_ars: 30, rf_usd: 25, rv_global: 5, rv_arg: 0, cripto: 0 },
  },
  {
    id: 'conservador', name: 'Conservador', emoji: '🌱',
    desc: 'Buscás proteger tu plata y ganarle a la inflación, aceptando pequeñas oscilaciones.',
    alloc: { liquidez: 25, rf_ars: 25, rf_usd: 30, rv_global: 15, rv_arg: 5, cripto: 0 },
  },
  {
    id: 'moderado', name: 'Moderado', emoji: '⚖️',
    desc: 'Equilibrás crecimiento y estabilidad. Aceptás caídas temporarias a cambio de mejores rendimientos en el mediano plazo.',
    alloc: { liquidez: 10, rf_ars: 15, rf_usd: 30, rv_global: 30, rv_arg: 10, cripto: 5 },
  },
  {
    id: 'agresivo', name: 'Agresivo', emoji: '🚀',
    desc: 'Buscás que tu plata crezca a largo plazo y tolerás caídas fuertes en el camino.',
    alloc: { liquidez: 5, rf_ars: 5, rf_usd: 20, rv_global: 45, rv_arg: 15, cripto: 10 },
  },
  {
    id: 'muy_agresivo', name: 'Muy agresivo', emoji: '🔥',
    desc: 'Máximo crecimiento con horizonte largo. Sabés que tu cartera puede caer 30–40% en un mal año.',
    alloc: { liquidez: 5, rf_ars: 0, rf_usd: 10, rv_global: 55, rv_arg: 18, cripto: 12 },
  },
];
// Puntaje (0-100) a partir del cual se asigna cada perfil.
export const PROFILE_THRESHOLDS = [0, 25, 42, 60, 78];

// ---------------------------------------------------------------------
// Test de perfil de inversor.
// cap: tope de perfil (índice en PROFILES) si elegís esa respuesta.
// ---------------------------------------------------------------------
export const QUIZ = [
  {
    id: 'goal', q: '¿Cuál es tu objetivo principal con esta inversión?',
    options: [
      { v: 'emergencia', label: 'Armar un fondo de emergencia', pts: 0, cap: 0 },
      { v: 'corto', label: 'Comprar algo en 1 a 3 años (viaje, auto…)', pts: 3, cap: 2 },
      { v: 'casa', label: 'Un proyecto grande en 3 a 7 años (casa, estudios)', pts: 6 },
      { v: 'dolares', label: 'Ahorrar en dólares y protegerme de la inflación', pts: 5 },
      { v: 'retiro', label: 'Retiro / independencia financiera a largo plazo', pts: 9 },
      { v: 'crecer', label: 'Hacer crecer mi plata lo máximo posible', pts: 10 },
    ],
  },
  {
    id: 'horizon', q: '¿Cuándo pensás que vas a necesitar esta plata?',
    options: [
      { v: 0.5, label: 'En menos de 1 año', pts: 0, cap: 1 },
      { v: 2, label: 'Entre 1 y 3 años', pts: 5, cap: 2 },
      { v: 4, label: 'Entre 3 y 5 años', pts: 10 },
      { v: 7, label: 'Entre 5 y 10 años', pts: 15 },
      { v: 12, label: 'En más de 10 años', pts: 20 },
    ],
  },
  {
    id: 'age', q: '¿Qué edad tenés?',
    options: [
      { v: 25, label: 'Menos de 30', pts: 10 },
      { v: 37, label: 'Entre 30 y 45', pts: 7 },
      { v: 52, label: 'Entre 45 y 60', pts: 4 },
      { v: 65, label: 'Más de 60', pts: 1 },
    ],
  },
  {
    id: 'income', q: '¿Qué tan estables son tus ingresos?',
    options: [
      { v: 'estable', label: 'Muy estables (sueldo fijo en relación de dependencia)', pts: 10 },
      { v: 'variable', label: 'Algo variables (freelance, comisiones)', pts: 6 },
      { v: 'inestable', label: 'Inestables o inciertos', pts: 2 },
    ],
  },
  {
    id: 'emergency', q: '¿Tenés un fondo de emergencia (ahorro para imprevistos)?',
    help: 'Lo ideal es tener entre 3 y 6 meses de gastos guardados en algo líquido.',
    options: [
      { v: 'si', label: 'Sí, cubre 6 meses o más de gastos', pts: 10 },
      { v: 'parcial', label: 'Algo tengo, entre 1 y 6 meses', pts: 6 },
      { v: 'no', label: 'No tengo', pts: 0 },
    ],
  },
  {
    id: 'experience', q: '¿En qué invertiste alguna vez?',
    options: [
      { v: 0, label: 'Nunca invertí', pts: 0 },
      { v: 1, label: 'Plazo fijo, FCI o dólares', pts: 3 },
      { v: 2, label: 'Bonos, acciones o CEDEARs', pts: 7 },
      { v: 3, label: 'Opero seguido / tengo cripto', pts: 10 },
    ],
  },
  {
    id: 'drawdown', q: 'Invertiste $1.000.000 y en un mes vale $800.000 (cayó 20%). ¿Qué hacés?',
    options: [
      { v: 'vendo', label: 'Vendo todo para no perder más', pts: 0, cap: 1 },
      { v: 'parte', label: 'Vendo una parte', pts: 4 },
      { v: 'espero', label: 'Espero a que se recupere', pts: 8 },
      { v: 'compro', label: 'Aprovecho y compro más', pts: 12 },
    ],
  },
  {
    id: 'tradeoff', q: 'En un año, ¿cuál de estas opciones elegirías?',
    options: [
      { v: 1, label: 'Ganar 5% seguro', pts: 0 },
      { v: 2, label: 'Ganar 10%, con chance de perder hasta 5%', pts: 4 },
      { v: 3, label: 'Ganar 20%, con chance de perder hasta 15%', pts: 8 },
      { v: 4, label: 'Ganar 40%, con chance de perder hasta 35%', pts: 12 },
    ],
  },
  {
    id: 'share', q: '¿Qué parte de tus ahorros totales vas a invertir acá?',
    options: [
      { v: 'todo', label: 'Casi todos mis ahorros', pts: 2 },
      { v: 'mitad', label: 'Más o menos la mitad', pts: 5 },
      { v: 'parte', label: 'Una parte chica', pts: 9 },
    ],
  },
  {
    id: 'knowledge', q: 'Si suben las tasas de interés, ¿qué pasa en general con el precio de los bonos?',
    help: 'No pasa nada si no sabés: sirve para ajustar las explicaciones.',
    options: [
      { v: 'baja', label: 'Baja', pts: 6 },
      { v: 'sube', label: 'Sube', pts: 1 },
      { v: 'nose', label: 'No sé', pts: 0 },
    ],
  },
];

// ---------------------------------------------------------------------
// Instrumentos sugeridos por clase. "kind" debe existir en KINDS.
// pick: 'fixed' (símbolo fijo) | 'liquid' (el más operado del panel que cumpla el filtro)
// ---------------------------------------------------------------------
export const PICKS = {
  liquidez: [
    { kind: 'fci', symbol: 'auto-mm', name: 'FCI Money Market', weight: 100,
      why: 'Rescate inmediato y rinde todos los días. Ideal para el fondo de emergencia. Lo podés suscribir desde tu banco o broker.' },
  ],
  rf_ars: [
    { kind: 'letra', pick: 'liquid', filter: 'lecap', name: 'LECAP (Letra a tasa fija)', weight: 50,
      why: 'Te asegura una tasa fija en pesos hasta el vencimiento. Conviene cuando se espera que la inflación baje.' },
    { kind: 'bono', symbol: 'TZX27', alt: ['TX28', 'TZXD7', 'TZX28'], name: 'Bono CER', weight: 50,
      why: 'Ajusta por inflación (CER) más un interés. Te protege si la inflación sube.' },
  ],
  rf_usd: [
    { kind: 'bono', symbol: 'GD30D', alt: ['AL30D', 'GD35D'], name: 'Bono soberano Global 2030 (USD)', weight: 50,
      why: 'Bono del Estado en dólares, ley Nueva York, de los más líquidos. Paga intereses y amortiza cada 6 meses.' },
    { kind: 'on', pick: 'liquid', filter: 'usd', name: 'Obligación Negociable (ON) en USD', weight: 50,
      why: 'Deuda de empresas en dólares. Suele tener menos riesgo que los bonos del Estado y paga intereses periódicos.' },
  ],
  rv_global: [
    { kind: 'cedear', symbol: 'SPY', name: 'CEDEAR SPY (S&P 500)', weight: 70,
      why: 'Con una sola compra tenés las 500 empresas más grandes de EE.UU. Diversificado y de bajo costo.' },
    { kind: 'cedear', symbol: 'QQQ', name: 'CEDEAR QQQ (Nasdaq 100)', weight: 30, minProfile: 2,
      why: 'Las 100 tecnológicas más grandes. Más crecimiento esperado, pero más volátil.' },
  ],
  rv_arg: [
    { kind: 'accion', symbol: 'GGAL', name: 'Grupo Financiero Galicia', weight: 34, why: 'Banco líder, muy ligado a la economía argentina.' },
    { kind: 'accion', symbol: 'YPFD', name: 'YPF', weight: 33, why: 'Energía (Vaca Muerta), de las acciones más operadas.' },
    { kind: 'accion', symbol: 'PAMP', name: 'Pampa Energía', weight: 33, why: 'Energía y generación eléctrica, empresa sólida del panel líder.' },
  ],
  cripto: [
    { kind: 'cripto', symbol: 'BTC', name: 'Bitcoin', weight: 70, why: 'La cripto más grande y establecida.' },
    { kind: 'cripto', symbol: 'ETH', name: 'Ethereum', weight: 30, why: 'Segunda cripto más grande, plataforma de contratos inteligentes.' },
  ],
};

// ---------------------------------------------------------------------
// Tipos de activo soportados en la cartera / mercado.
// divisor: los bonos, letras y ONs cotizan cada 100 nominales.
// ---------------------------------------------------------------------
export const KINDS = {
  accion: { label: 'Acción argentina', panel: 'arg_stocks', hist: 'stocks', cls: 'rv_arg', divisor: 1 },
  cedear: { label: 'CEDEAR', panel: 'arg_cedears', hist: 'cedears', cls: 'rv_global', divisor: 1 },
  bono: { label: 'Bono', panel: 'arg_bonds', hist: 'bonds', cls: null, divisor: 100 },
  letra: { label: 'Letra (LECAP)', panel: 'arg_notes', hist: 'bonds', cls: 'rf_ars', divisor: 100 },
  on: { label: 'Obligación Negociable', panel: 'arg_corp', hist: null, cls: null, divisor: 100 },
  usa: { label: 'Acción/ETF EE.UU. (USD)', panel: 'usa_stocks', hist: 'usa', cls: 'rv_global', divisor: 1 },
  cripto: { label: 'Cripto', panel: 'crypto', hist: 'crypto', cls: 'cripto', divisor: 1 },
  fci: { label: 'Fondo Común de Inversión', panel: 'fci', hist: null, cls: null, divisor: 1 },
  dolar: { label: 'Dólares', panel: null, hist: null, cls: 'liquidez', divisor: 1 },
  pf: { label: 'Plazo fijo', panel: null, hist: null, cls: 'rf_ars', divisor: 1 },
  manual: { label: 'Otro (precio manual)', panel: null, hist: null, cls: null, divisor: 1 },
};

export const CRYPTO_LIST = [
  { symbol: 'BTC', name: 'Bitcoin', cg: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', cg: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', cg: 'solana' },
  { symbol: 'BNB', name: 'BNB', cg: 'binancecoin' },
  { symbol: 'XRP', name: 'XRP', cg: 'ripple' },
  { symbol: 'ADA', name: 'Cardano', cg: 'cardano' },
  { symbol: 'DOGE', name: 'Dogecoin', cg: 'dogecoin' },
  { symbol: 'AVAX', name: 'Avalanche', cg: 'avalanche-2' },
  { symbol: 'DOT', name: 'Polkadot', cg: 'polkadot' },
  { symbol: 'LINK', name: 'Chainlink', cg: 'chainlink' },
  { symbol: 'LTC', name: 'Litecoin', cg: 'litecoin' },
  { symbol: 'MATIC', name: 'Polygon', cg: 'matic-network', binance: 'POLUSDT' },
  { symbol: 'USDT', name: 'Tether (dólar cripto)', cg: 'tether', stable: true },
];

// Nombres amigables para algunos símbolos conocidos.
export const NAMES = {
  SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', DIA: 'Dow Jones ETF', IWM: 'Russell 2000 ETF', EEM: 'Mercados emergentes ETF',
  EWZ: 'Brasil ETF', VOO: 'Vanguard S&P 500', VTI: 'Vanguard Total Market', GLD: 'Oro ETF', XLE: 'Energía ETF', ARKK: 'ARK Innovation',
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet (Google)', AMZN: 'Amazon', META: 'Meta', TSLA: 'Tesla',
  MELI: 'Mercado Libre', KO: 'Coca-Cola', BRKB: 'Berkshire Hathaway', 'BRK.B': 'Berkshire Hathaway', VIST: 'Vista Energy', GLOB: 'Globant',
  GGAL: 'Grupo Fin. Galicia', YPFD: 'YPF', PAMP: 'Pampa Energía', BMA: 'Banco Macro', TXAR: 'Ternium Argentina', ALUA: 'Aluar',
  CEPU: 'Central Puerto', TGSU2: 'Transp. Gas del Sur', TGNO4: 'Transp. Gas del Norte', COME: 'Soc. Comercial del Plata', LOMA: 'Loma Negra',
  CRES: 'Cresud', EDN: 'Edenor', SUPV: 'Supervielle', BYMA: 'BYMA', VALO: 'Grupo Valores', TECO2: 'Telecom', MIRG: 'Mirgor', BBAR: 'BBVA Argentina',
  AL30: 'Bonar 2030 (ARS)', AL30D: 'Bonar 2030 (USD)', GD30: 'Global 2030 (ARS)', GD30D: 'Global 2030 (USD)', AL35D: 'Bonar 2035 (USD)',
  GD35D: 'Global 2035 (USD)', AL29D: 'Bonar 2029 (USD)', GD29D: 'Global 2029 (USD)', GD38D: 'Global 2038 (USD)', GD41D: 'Global 2041 (USD)',
  GD46D: 'Global 2046 (USD)', AE38D: 'Bonar 2038 (USD)', TX28: 'Boncer 2028 (CER)', TZX27: 'Boncer cero cupón 2027 (CER)', TZX28: 'Boncer cero cupón 2028 (CER)',
};

// ---------------------------------------------------------------------
// Mercado: categorías y watchlist por defecto.
// ---------------------------------------------------------------------
export const MARKET_SECTIONS = [
  { id: 'dolares', label: 'Dólares', icon: '💵' },
  { id: 'indicadores', label: 'Indicadores', icon: '📊' },
  { id: 'cedear', label: 'CEDEARs', icon: '🌎', kind: 'cedear' },
  { id: 'accion', label: 'Acciones AR', icon: '🇦🇷', kind: 'accion' },
  { id: 'bono', label: 'Bonos', icon: '📜', kind: 'bono' },
  { id: 'letra', label: 'Letras', icon: '🧾', kind: 'letra' },
  { id: 'on', label: 'ONs', icon: '🏢', kind: 'on' },
  { id: 'usa', label: 'EE.UU. (USD)', icon: '🇺🇸', kind: 'usa' },
  { id: 'cripto', label: 'Cripto', icon: '🪙', kind: 'cripto' },
];

export const DEFAULT_WATCH = {
  cedear: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'MELI', 'KO', 'GOOGL'],
  accion: ['GGAL', 'YPFD', 'PAMP', 'BMA', 'TXAR', 'CEPU', 'ALUA', 'VIST'],
  bono: ['AL30D', 'GD30D', 'GD35D', 'AL30', 'GD30', 'TX28', 'TZX27'],
  letra: [],
  on: [],
  usa: ['VOO', 'AAPL', 'NVDA', 'MSFT', 'AMZN', 'TSLA'],
  cripto: ['BTC', 'ETH', 'SOL', 'USDT'],
};
export const DEFAULT_SECTIONS = ['dolares', 'indicadores', 'cedear', 'accion', 'bono', 'cripto'];

// ---------------------------------------------------------------------
// Frecuencia de actualización (ms) y caché.
// data912 refresca cada ~20 s (límite 120 req/min).
// ---------------------------------------------------------------------
export const REFRESH = {
  crypto: 15_000,
  panels: 60_000,
  dolares: 120_000,
  indicators: 30 * 60_000,
};

// ---------------------------------------------------------------------
// Umbrales para el feed de novedades y rebalanceo.
// ---------------------------------------------------------------------
export const RULES = {
  rebalanceDriftPct: 5,       // pp de desvío por clase para sugerir rebalanceo
  bigMove30dPct: 10,          // movimiento fuerte de un activo en 30 días
  fxMoveWeekPct: 2,           // movimiento del dólar en 7 días
  brechaAltaPct: 15,          // brecha CCL vs oficial
  riesgoPaisAlto: 1200,
  emergencyShareIfNo: 70,     // % del aporte a liquidez si no hay fondo de emergencia
  emergencyShareIfPartial: 35,
};

export const FX_CASAS = [
  { id: 'bolsa', label: 'MEP (Bolsa)' },
  { id: 'contadoconliqui', label: 'CCL' },
  { id: 'oficial', label: 'Oficial' },
  { id: 'blue', label: 'Blue' },
  { id: 'cripto', label: 'Cripto' },
];

export const DISCLAIMER = 'Herramienta educativa y orientativa. No constituye asesoramiento financiero profesional ni recomendación de compra/venta. Las sugerencias se generan con reglas automáticas; los rendimientos pasados no garantizan rendimientos futuros. Consultá con un asesor matriculado (ALyC/CNV) antes de tomar decisiones importantes.';

// =====================================================================
// ETAPA 2
// =====================================================================

// Supuestos de rendimiento REAL anual en dólares (descontada la inflación
// de EE.UU.) y volatilidad anual por clase. Son estimaciones conservadoras
// de largo plazo para el simulador; editalas si querés.
export const CLASS_RETURNS = {
  rv_global: { mu: 0.06, sigma: 0.16 },
  rf_usd: { mu: 0.045, sigma: 0.10 },
  liquidez: { mu: 0.0, sigma: 0.03 },
  rf_ars: { mu: 0.015, sigma: 0.12 },
  rv_arg: { mu: 0.07, sigma: 0.35 },
  cripto: { mu: 0.08, sigma: 0.70 },
};
export const ASSUMED_CORRELATION = 0.3;
export const SIM_RUNS = 1000;

export const GOAL_EMOJIS = ['🏠', '✈️', '🚗', '🎓', '🏖️', '💍', '👶', '🛟', '🌅', '💼', '🎸', '🐶'];

// Recordatorio del aporte mensual (día del mes por defecto).
export const DEFAULT_REMINDER_DAY = 5;

// ---------------------------------------------------------------------
// Sincronización (opcional, gratis con Firebase plan Spark).
// Pegá acá la configuración de tu proyecto para que todos tus dispositivos
// la tengan automáticamente (ver README). Si queda en null, también se
// puede pegar desde Ajustes → Sincronización.
// Esta configuración NO es secreta: la seguridad la dan las reglas de Firestore.
// ---------------------------------------------------------------------
// Import the functions you need from the SDKs you need

// Your web app's Firebase configuration
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCX98llnQiFUpuMF4538-19tcmkgxJshSY",
  authDomain: "mi-asesor-fc02c.firebaseapp.com",
  projectId: "mi-asesor-fc02c",
  storageBucket: "mi-asesor-fc02c.firebasestorage.app",
  messagingSenderId: "176577919539",
  appId: "1:176577919539:web:0159ca481f030e90c3c146"
};
