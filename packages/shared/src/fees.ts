// Fee and loan estimates for display. Amounts go in and come out as decimal strings.
// shortcut: standard amortized-loan maths with floats, rounded to 2 decimals; the ledger's exact interest
// formula is not confirmed, so treat these as estimates and compare against a real LoanPay on Devnet.

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

// The platform's cut of some interest. managementFeeRate is in tenths of a basis point (10000 = 10 percent).
export function platformFeeOn(interest: string, managementFeeRate: number): string {
  return ((Number(interest) * managementFeeRate) / 100000).toFixed(2);
}

export interface LoanEstimateInput {
  principal: string;
  interestRate: number; // yearly, tenths of a basis point (5000 = 5 percent)
  paymentTotal: number;
  paymentIntervalSec: number;
  managementFeeRate?: number; // defaults to 10000, the LoanBroker's rate
}

export interface LoanEstimate {
  periodicPayment: string; // one installment, before the ledger's service fee
  totalRepaid: string;
  totalInterest: string;
  platformFee: string; // the broker's share of the interest
  depositorShare: string; // the rest of the interest
}

// Equal payments (annuity): payment = P × r / (1 − (1 + r)^−n), with r the rate for one interval.
export function estimateLoan({
  principal, interestRate, paymentTotal, paymentIntervalSec, managementFeeRate = 10000,
}: LoanEstimateInput): LoanEstimate {
  const p = Number(principal);
  const r = (interestRate / 100000) * (paymentIntervalSec / SECONDS_PER_YEAR);
  const payment = r === 0 ? p / paymentTotal : (p * r) / (1 - (1 + r) ** -paymentTotal);
  const interest = payment * paymentTotal - p;
  const fee = Number(platformFeeOn(String(interest), managementFeeRate));
  return {
    periodicPayment: payment.toFixed(2),
    totalRepaid: (payment * paymentTotal).toFixed(2),
    totalInterest: interest.toFixed(2),
    platformFee: fee.toFixed(2),
    depositorShare: (interest - fee).toFixed(2),
  };
}
