import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchCitiesByDepartment, fetchDepartments, type ColombiaPlace } from "./colombia-geo";

/**
 * Estado de un selector Departamento -> Municipio en cascada: al elegir un
 * departamento se cargan sus municipios y se limpia la ciudad elegida
 * antes. Expone los nombres (no los ids) porque `tenants.department`/
 * `city` en la base de datos son texto libre, no una referencia a esta API.
 */
export function useColombiaLocation() {
  const [departments, setDepartments] = useState<ColombiaPlace[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [departmentId, setDepartmentIdState] = useState("");

  const [cities, setCities] = useState<ColombiaPlace[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [cityName, setCityName] = useState("");

  useEffect(() => {
    let active = true;
    fetchDepartments()
      .then((d) => { if (active) setDepartments(d); })
      .catch(() => { if (active) toast.error("No se pudieron cargar los departamentos (api-colombia.com no respondió)"); })
      .finally(() => { if (active) setLoadingDepartments(false); });
    return () => { active = false; };
  }, []);

  function setDepartmentId(id: string) {
    setDepartmentIdState(id);
    setCityName("");
    setCities([]);
    if (!id) return;
    setLoadingCities(true);
    fetchCitiesByDepartment(Number(id))
      .then((c) => setCities(c))
      .catch(() => toast.error("No se pudieron cargar los municipios (api-colombia.com no respondió)"))
      .finally(() => setLoadingCities(false));
  }

  const departmentName = departments.find((d) => String(d.id) === departmentId)?.name ?? "";

  return {
    departments, loadingDepartments, departmentId, setDepartmentId, departmentName,
    cities, loadingCities, cityName, setCityName,
  };
}
