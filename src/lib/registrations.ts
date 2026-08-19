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
    const { error } = await supabase.from("registrations").insert({
      event_id: input.event_id,
      tenant_id: input.tenant_id,
      category_id: input.category_id,
      status: "pending",
      qr_code,
      amount: input.amount,
      athlete_document: input.athlete.document_id,
      athlete_name: input.athlete.full_name,
      athlete_email: input.athlete.email,
      athlete_phone: input.athlete.phone,
      athlete_birth_date: input.athlete.birth_date,
      athlete_gender: input.athlete.gender,
    });
    if (error) throw error;
  }

  return { qr_code, amount: input.amount, status: "pending" as const };
}
