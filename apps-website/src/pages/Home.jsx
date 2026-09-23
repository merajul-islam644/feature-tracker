// Single-page marketing surface per DESIGN.md §5.3 / §14 (Step 14).
// Navbar is fixed, so the <main> starts with `pt-[72px]` to offset.
import Navbar from "../components/layout/Navbar.jsx";
import Footer from "../components/layout/Footer.jsx";
import Hero from "../components/marketing/Hero.jsx";
import FeaturesSection from "../components/marketing/FeaturesSection.jsx";
import HowItWorks from "../components/marketing/HowItWorks.jsx";
import ProductVisual from "../components/marketing/ProductVisual.jsx";
import CTASection from "../components/marketing/CTASection.jsx";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="pt-[72px]">
        <Hero />
        <FeaturesSection />
        <HowItWorks />
        <ProductVisual />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
