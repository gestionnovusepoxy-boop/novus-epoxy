export const metadata = {
  title: 'Politique de confidentialité — Novus Epoxy',
};

export default function PolitiqueConfidentialite() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Politique de confidentialité</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>Dernière mise à jour : 18 mars 2026</p>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>1. Responsable</h2>
        <p>Novus Epoxy, entreprise spécialisée en planchers époxy au Québec.</p>
        <p>Courriel : gestionnovusepoxy@gmail.com</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>2. Données collectées</h2>
        <p>Nous collectons les données suivantes lorsque vous utilisez nos services :</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: 1.8 }}>
          <li>Nom, adresse courriel, numéro de téléphone (formulaires de soumission)</li>
          <li>Messages échangés via notre chat en ligne ou Messenger</li>
          <li>Données de navigation anonymes (pages visitées, appareil, navigateur)</li>
        </ul>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>3. Utilisation des données</h2>
        <p>Vos données sont utilisées pour :</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: 1.8 }}>
          <li>Répondre à vos demandes de soumission</li>
          <li>Vous fournir un service de chat et de support</li>
          <li>Vous envoyer des communications liées à nos services (devis, rappels)</li>
          <li>Améliorer notre site web et nos services</li>
        </ul>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>4. Partage des données</h2>
        <p>Nous ne vendons jamais vos données personnelles. Elles peuvent être partagées avec :</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: 1.8 }}>
          <li>Nos fournisseurs de services (hébergement, courriel, SMS) uniquement pour opérer nos services</li>
          <li>Les autorités si requis par la loi</li>
        </ul>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>5. Conservation</h2>
        <p>Vos données sont conservées aussi longtemps que nécessaire pour fournir nos services, puis supprimées dans un délai raisonnable.</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>6. Vos droits</h2>
        <p>Conformément à la Loi 25 du Québec, vous avez le droit de :</p>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: 1.8 }}>
          <li>Accéder à vos données personnelles</li>
          <li>Demander la rectification ou la suppression de vos données</li>
          <li>Retirer votre consentement à tout moment</li>
        </ul>
        <p style={{ marginTop: '0.5rem' }}>Pour exercer ces droits, contactez-nous à gestionnovusepoxy@gmail.com.</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>7. Suppression des données</h2>
        <p>Vous pouvez demander la suppression de toutes vos données personnelles en nous écrivant à gestionnovusepoxy@gmail.com. Nous traiterons votre demande dans les 30 jours.</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>8. Modifications</h2>
        <p>Cette politique peut être modifiée à tout moment. La date de mise à jour sera ajustée en conséquence.</p>
      </section>
    </main>
  );
}
