/**
 * Stripe client
 *
 * Build 1 — stubs just enough of the interface to make the BillingView render.
 * Build 4 — replaces the stubs with real Stripe SDK calls, sets up webhooks,
 *           and wires Checkout Sessions for both subscriptions and top-ups.
 */

export interface CheckoutSessionInput {
  uid: string;
  email: string;
  type: 'subscription' | 'topup';
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionOutput {
  sessionId: string;
  url: string;
}

export interface StripeClient {
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionOutput>;
}

class StubStripeClient implements StripeClient {
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionOutput> {
    return {
      sessionId: `cs_stub_${Date.now()}`,
      url: `${input.successUrl}?stub=true&session_id=cs_stub_${Date.now()}`,
    };
  }
}

export const stripeClient: StripeClient = new StubStripeClient();
