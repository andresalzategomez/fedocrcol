/**
 * Departamentos y municipios de Colombia, vía la API pública de
 * api-colombia.com (sin API key). Se cachea en memoria por pestaña: la
 * lista de departamentos no cambia en la sesión, y los municipios de un
 * departamento tampoco -- evita repetir la misma llamada cada vez que se
 * abre un formulario.
 */
const BASE = "https://api-colombia.com/api/v1";

export interface ColombiaPlace {
  id: number;
  name: string;
}

interface RawPlace {
  id: number;
  name: string;
}

let departmentsCache: ColombiaPlace[] | null = null;
const citiesCache = new Map<number, ColombiaPlace[]>();

function sortByName(list: ColombiaPlace[]): ColombiaPlace[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function fetchDepartments(): Promise<ColombiaPlace[]> {
  if (departmentsCache) return departmentsCache;
  const res = await fetch(`${BASE}/Department`);
  if (!res.ok) throw new Error("No se pudieron cargar los departamentos");
  const data = (await res.json()) as RawPlace[];
  departmentsCache = sortByName(data.map((d) => ({ id: d.id, name: d.name })));
  return departmentsCache;
}

export async function fetchCitiesByDepartment(departmentId: number): Promise<ColombiaPlace[]> {
  const cached = citiesCache.get(departmentId);
  if (cached) return cached;
  const res = await fetch(`${BASE}/Department/${departmentId}/cities`);
  if (!res.ok) throw new Error("No se pudieron cargar los municipios");
  const data = (await res.json()) as RawPlace[];
  const cities = sortByName(data.map((c) => ({ id: c.id, name: c.name })));
  citiesCache.set(departmentId, cities);
  return cities;
}
