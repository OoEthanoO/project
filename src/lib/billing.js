export const fetchBalance = async (userId) => {
    const res = await fetch(`/api/billing/balance?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to fetch balance');
    }
    const data = await res.json();
    return data.balanceCents ?? 0;
};
export const topUp = async (userId, amountCents, reference, idempotencyKey) => {
    const res = await fetch('/api/billing/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amountCents, reference, idempotencyKey })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Top-up failed');
    }
    return res.json();
};
