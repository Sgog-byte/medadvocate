const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://medadvocate.org';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

const SUB_PRICES = [
  'price_1TS2I35jVY07VRUx6fjbi0CJ',
  'price_1TS2MC5jVY07VRUxGkfI4j5l',
  'price_1TS2OY5jVY07VRUxQrR0Sh2V',
  'price_1TS2Pz5jVY07VRUxfjvFhgu6',
];

// ⚠️ SECURITY NOTE: This endpoint is intentionally left UNAUTHENTICATED for now.
// Buyers may reach the checkout page before they have a Supabase account/session,
// so requiring a JWT here would block purchases. Its blast radius is limited: it
// only creates Stripe Checkout sessions (no Anthropic spend, no PHI access).
// REVISIT once the Stripe webhook is built — at that point, tie checkout to an
// authenticated user (or add rate limiting) so it can't be abused to spam
// session/customer creation. See AUDIT.md HIGH-1.
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  try {
    const { lineItems, successUrl, cancelUrl, addons } = JSON.parse(event.body);

    const hasSubscription = lineItems.some(i => SUB_PRICES.includes(i.price));
    const subItems = lineItems.filter(i => SUB_PRICES.includes(i.price));
    const oneTimeItems = lineItems.filter(i => !SUB_PRICES.includes(i.price));

    let session;

    if (hasSubscription && oneTimeItems.length > 0) {
      // Mixed: create customer first, add invoice items for one-time, then subscription checkout
      const customer = await stripe.customers.create();
      for (const item of oneTimeItems) {
        await stripe.invoiceItems.create({
          customer: customer.id,
          price: item.price,
          quantity: item.quantity,
        });
      }
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.id,
        line_items: subItems,
        success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        metadata: { addons: addons || '' },
        subscription_data: { metadata: { addons: addons || '' } },
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
      });

    } else if (hasSubscription) {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: subItems,
        success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        metadata: { addons: addons || '' },
        subscription_data: { metadata: { addons: addons || '' } },
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
      });

    } else {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: oneTimeItems,
        success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        metadata: { addons: addons || '' },
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({ id: session.id }),
    };

  } catch (error) {
    console.error('Stripe error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
