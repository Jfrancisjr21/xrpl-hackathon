// The logo doubles as the home link: it always returns to the main Lender screen.
export function BrandLogo() {
  return (
    <a className="product-lockup" href="/" aria-label="Confiance XRPL, home">
      <img className="brand-symbol brand-symbol--color" src="/brand/open-ledger-symbol-forest.svg" width="115" height="115" alt="" />
      <img className="brand-symbol brand-symbol--white" src="/brand/open-ledger-symbol-forest-light.svg" width="115" height="115" alt="" />
      <div className="brand-wordmark" aria-hidden="true"><b>confiance</b><small>xrpl</small></div>
    </a>
  );
}
