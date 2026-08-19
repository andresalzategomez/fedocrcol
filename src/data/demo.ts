export type League = {
  id: string;
  name: string;
  slug: string;
  department: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  banner_url: string | null;
  status: "active" | "suspended";
  city: string;
  athletes: number;
  description: string;
};

export type EventCategory = {
  id: string;
  event_id: string;
  name: string;
  price: number;
  slots_available: number;
};

export type OcrEvent = {
  id: string;
  tenant_id: string;
  title: string;
  date: string;
  location: string;
  max_capacity: number;
  registered: number;
  distance_km: number;
  obstacles: number;
  image_hint: string;
  categories: EventCategory[];
};

export type RankingRow = {
  position: number;
  athlete: string;
  tenant_id: string;
  category: string;
  races: number;
  points: number;
  qualified: boolean;
};

export const DEMO_LEAGUES: League[] = [
  {
    id: "t-ant",
    name: "Liga OCR Antioquia",
    slug: "antioquia",
    department: "Antioquia",
    logo_url: null,
    primary_color: "#F0562A",
    secondary_color: "#C8F02A",
    banner_url: null,
    status: "active",
    city: "Medellín",
    athletes: 412,
    description:
      "La liga con más obstáculos verticales del país. Entrenamientos en las laderas del Valle de Aburrá.",
  },
  {
    id: "t-cun",
    name: "Liga OCR Cundinamarca",
    slug: "cundinamarca",
    department: "Cundinamarca",
    logo_url: null,
    primary_color: "#2A9DF0",
    secondary_color: "#F0C22A",
    banner_url: null,
    status: "active",
    city: "Bogotá D.C.",
    athletes: 587,
    description:
      "Altura, barro y frío. La liga más numerosa, sede de la final nacional de clasificación mundialista.",
  },
  {
    id: "t-val",
    name: "Liga OCR Valle del Cauca",
    slug: "valle-del-cauca",
    department: "Valle del Cauca",
    logo_url: null,
    primary_color: "#22B573",
    secondary_color: "#F05A8F",
    banner_url: null,
    status: "active",
    city: "Cali",
    athletes: 336,
    description: "Velocidad pura en clima cálido. Especialistas en carreras cortas tipo sprint OCR.",
  },
  {
    id: "t-atl",
    name: "Liga OCR Atlántico",
    slug: "atlantico",
    department: "Atlántico",
    logo_url: null,
    primary_color: "#F0A32A",
    secondary_color: "#2AD1F0",
    banner_url: null,
    status: "active",
    city: "Barranquilla",
    athletes: 214,
    description: "Arena, playa y calor extremo. Cuna de los mejores obstáculos de carga del Caribe.",
  },
  {
    id: "t-san",
    name: "Liga OCR Santander",
    slug: "santander",
    department: "Santander",
    logo_url: null,
    primary_color: "#8B5CF6",
    secondary_color: "#C8F02A",
    banner_url: null,
    status: "active",
    city: "Bucaramanga",
    athletes: 189,
    description: "Cañones y trail técnico. La liga con las rutas de montaña más exigentes.",
  },
  {
    id: "t-eje",
    name: "Liga OCR Eje Cafetero",
    slug: "eje-cafetero",
    department: "Risaralda",
    logo_url: null,
    primary_color: "#D96C2C",
    secondary_color: "#4CAF50",
    banner_url: null,
    status: "suspended",
    city: "Pereira",
    athletes: 96,
    description: "Carreras entre cafetales. Liga en proceso de re-habilitación ante la Federación.",
  },
];

export const DEMO_EVENTS: OcrEvent[] = [
  {
    id: "e-1",
    tenant_id: "t-ant",
    title: "Aburrá Beast Race",
    date: "2026-09-19",
    location: "Parque Arví, Medellín",
    max_capacity: 800,
    registered: 612,
    distance_km: 12,
    obstacles: 28,
    image_hint: "montaña",
    categories: [
      { id: "c-1", event_id: "e-1", name: "Élite", price: 210000, slots_available: 34 },
      { id: "c-2", event_id: "e-1", name: "Age Group", price: 165000, slots_available: 96 },
      { id: "c-3", event_id: "e-1", name: "Open", price: 120000, slots_available: 58 },
    ],
  },
  {
    id: "e-2",
    tenant_id: "t-cun",
    title: "Sabana Mud Nationals",
    date: "2026-10-10",
    location: "Tocancipá, Cundinamarca",
    max_capacity: 1200,
    registered: 934,
    distance_km: 15,
    obstacles: 35,
    image_hint: "barro",
    categories: [
      { id: "c-4", event_id: "e-2", name: "Élite", price: 240000, slots_available: 18 },
      { id: "c-5", event_id: "e-2", name: "Age Group", price: 180000, slots_available: 120 },
      { id: "c-6", event_id: "e-2", name: "Relevos 3x", price: 320000, slots_available: 22 },
    ],
  },
  {
    id: "e-3",
    tenant_id: "t-val",
    title: "Pacífico Sprint OCR",
    date: "2026-11-07",
    location: "Pance, Cali",
    max_capacity: 600,
    registered: 288,
    distance_km: 5,
    obstacles: 20,
    image_hint: "sprint",
    categories: [
      { id: "c-7", event_id: "e-3", name: "Élite", price: 150000, slots_available: 60 },
      { id: "c-8", event_id: "e-3", name: "Open", price: 95000, slots_available: 140 },
      { id: "c-9", event_id: "e-3", name: "Juvenil", price: 60000, slots_available: 80 },
    ],
  },
  {
    id: "e-4",
    tenant_id: "t-atl",
    title: "Caribe Sand Warrior",
    date: "2026-12-05",
    location: "Puerto Colombia, Atlántico",
    max_capacity: 500,
    registered: 145,
    distance_km: 8,
    obstacles: 22,
    image_hint: "arena",
    categories: [
      { id: "c-10", event_id: "e-4", name: "Élite", price: 170000, slots_available: 70 },
      { id: "c-11", event_id: "e-4", name: "Open", price: 110000, slots_available: 180 },
    ],
  },
  {
    id: "e-5",
    tenant_id: "t-san",
    title: "Chicamocha Vertical",
    date: "2027-01-23",
    location: "Cañón del Chicamocha, Santander",
    max_capacity: 400,
    registered: 96,
    distance_km: 21,
    obstacles: 40,
    image_hint: "cañón",
    categories: [
      { id: "c-12", event_id: "e-5", name: "Élite Ultra", price: 280000, slots_available: 40 },
      { id: "c-13", event_id: "e-5", name: "Age Group", price: 195000, slots_available: 110 },
    ],
  },
];

export const DEMO_RANKING: RankingRow[] = [
  { position: 1, athlete: "Mariana Restrepo", tenant_id: "t-ant", category: "Élite F", races: 7, points: 1840, qualified: true },
  { position: 2, athlete: "Julián Ospina", tenant_id: "t-cun", category: "Élite M", races: 8, points: 1795, qualified: true },
  { position: 3, athlete: "Daniela Cortés", tenant_id: "t-cun", category: "Élite F", races: 7, points: 1710, qualified: true },
  { position: 4, athlete: "Andrés Quintero", tenant_id: "t-val", category: "Élite M", races: 6, points: 1655, qualified: true },
  { position: 5, athlete: "Laura Beltrán", tenant_id: "t-san", category: "Élite F", races: 6, points: 1520, qualified: true },
  { position: 6, athlete: "Camilo Nieto", tenant_id: "t-atl", category: "Élite M", races: 7, points: 1480, qualified: false },
  { position: 7, athlete: "Sofía Vargas", tenant_id: "t-ant", category: "Age Group", races: 5, points: 1395, qualified: false },
  { position: 8, athlete: "Kevin Moreno", tenant_id: "t-val", category: "Age Group", races: 6, points: 1340, qualified: false },
  { position: 9, athlete: "Paula Girón", tenant_id: "t-cun", category: "Age Group", races: 5, points: 1288, qualified: false },
  { position: 10, athlete: "Esteban Ruiz", tenant_id: "t-san", category: "Élite M", races: 5, points: 1210, qualified: false },
];

export const formatCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00`));

export const leagueById = (id: string) => DEMO_LEAGUES.find((l) => l.id === id);
export const leagueBySlug = (slug: string) => DEMO_LEAGUES.find((l) => l.slug === slug);
