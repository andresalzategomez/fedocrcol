import { supabase } from "./supabase";

export type RegistrationInput = {
  event_id: string;
  tenant_id: string;
  category_id: string;
  amount: number;
  athlete: {
    full_name: string;
    document_id: string;
    email: string;
    phone: string;
    birth_date: string;
    gender: "F" | "M" | "X";
    social_media?: string | undefined;
    eps: string;
    blood_type: string;
    emergency_contact_name: string;
    emergency_contact_phone: string;
    shirt_name: string;
    shirt_size: string;
  };
};

function makeReference(input: RegistrationInput) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OCR-${input.event_id.toUpperCase()}-${input.athlete.document_id.slice(-4)}-${random}`;
}

/**
 * Crea la inscripción en estado "pending".
 * El estado pasa a "paid" cuando la pasarela (Bold / PayU) llama al webhook
 * en /api/public/pagos/webhook.
 */
export async function createRegistration(input: RegistrationInput) {
  const qr_code = makeReference(input);

  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("registrations").insert({
      event_id: input.event_id,
      tenant_id: input.tenant_id,
      category_id: input.category_id,
      status: "pending",
      qr_code,
      amount: input.amount,
      athlete_id: userData.user?.id ?? null,
      athlete_document: input.athlete.document_id,
      athlete_name: input.athlete.full_name,
      athlete_email: input.athlete.email,
      athlete_phone: input.athlete.phone,
      athlete_birth_date: input.athlete.birth_date,
      athlete_gender: input.athlete.gender,
      athlete_social_media: input.athlete.social_media ?? null,
      athlete_eps: input.athlete.eps,
      athlete_blood_type: input.athlete.blood_type,
      athlete_emergency_contact_name: input.athlete.emergency_contact_name,
      athlete_emergency_contact_phone: input.athlete.emergency_contact_phone,
      athlete_shirt_name: input.athlete.shirt_name,
      athlete_shirt_size: input.athlete.shirt_size,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("Ya existe una inscripción con este documento para esta carrera.");
      }
      throw error;
    }

    if (userData.user) {
      await supabase.from("profiles").update({
        social_media: input.athlete.social_media ?? null,
        eps: input.athlete.eps,
        blood_type: input.athlete.blood_type,
        emergency_contact_name: input.athlete.emergency_contact_name,
        emergency_contact_phone: input.athlete.emergency_contact_phone,
        shirt_name: input.athlete.shirt_name,
        shirt_size: input.athlete.shirt_size,
      }).eq("id", userData.user.id);
    }
  }

  return { qr_code, amount: input.amount, status: "pending" as const };
}
