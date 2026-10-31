/**
 * Punto de extensión para captación de leads y atención a clientes.
 * Esta beta no marca ni reparte llamadas. Un adaptador de Zadarma o Twilio
 * implementará la misma interfaz y se asignará a `telephony` en el arranque.
 */
export interface OutboundCallInput {
  companyId: string;
  membershipId: string;
  to: string;
  leadId?: string | null;
}

export interface LeadAssignInput {
  companyId: string;
  leadId: string;
  campaignId?: string | null;
}

export interface TelephonyProvider {
  readonly kind: string;
  placeCall(input: OutboundCallInput): Promise<{ callId: string }>;
  handleWebhook(payload: unknown, signature: string | undefined): Promise<void>;
  /** Elige a quién entregar un lead nuevo. Hoy no asigna a nadie. */
  assignLead(input: LeadAssignInput): Promise<{ membershipId: string | null }>;
}

export class DisabledTelephonyProvider implements TelephonyProvider {
  readonly kind = 'desactivado';

  async placeCall(): Promise<{ callId: string }> {
    throw new Error('La telefonía (Zadarma o Twilio) todavía no está conectada.');
  }

  async handleWebhook(): Promise<void> {
    throw new Error('No hay webhook de telefonía configurado.');
  }

  async assignLead(): Promise<{ membershipId: string | null }> {
    return { membershipId: null };
  }
}

export const telephony: TelephonyProvider = new DisabledTelephonyProvider();
