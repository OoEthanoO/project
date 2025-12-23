export const createCheckoutSession = async (userId, amountCents) => {
    const res = await fetch('/api/payments/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amountCents })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create checkout session');
    }
    return res.json();
};
