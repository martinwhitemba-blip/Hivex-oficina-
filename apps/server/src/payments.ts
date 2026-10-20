/**
 * Punto de extensión para cobros. Esta beta NO cobra.
 * Más adelante un adaptador de Stripe implementará la misma interfaz
 * sin cambiar las pantallas: solo se sustituye el proveedor en el arranque.
 */
export interface CheckoutInput {
  companyId: string;
  planCode: string;
  successPath: string;
  cancelPath: string;
}

export interface PaymentProvider {
  readonly kind: string;
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  /** El hosting reenviará el webhook del proveedor a una ruta futura. */
  handleWebhook(payload: unknown, signature: string | undefined): Promise<void>;
}

export class ManualPaymentProvider implements PaymentProvider {
  readonly kind = 'manual';

  async createCheckout(): Promise<{ url: string }> {
    throw new Error('El pago en línea no está activado. El plan se puede cambiar sin cobro mientras llega la pasarela.');
  }

  async handleWebhook(): Promise<void> {
    throw new Error('No hay pasarela de pago configurada.');
  }
}

export const payments: PaymentProvider = new ManualPaymentProvider();
