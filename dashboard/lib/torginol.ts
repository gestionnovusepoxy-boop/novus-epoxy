// Torginol Flake Color Catalog for Novus Epoxy
// Colors from Torginol DecorativeFlake product line

export interface FlakeColor {
  name: string;
  code: string;
  colors: string; // description des couleurs principales
  category: 'classique' | 'terre' | 'ocean' | 'moderne' | 'premium';
}

export const FLAKE_COLORS: FlakeColor[] = [
  // Classiques
  { name: 'Domination', code: 'DOM', colors: 'gris, noir, blanc', category: 'classique' },
  { name: 'Nightfall', code: 'NTF', colors: 'noir, gris fonce, charcoal', category: 'classique' },
  { name: 'Granite', code: 'GRA', colors: 'gris moyen, noir, blanc', category: 'classique' },
  { name: 'Smokestone', code: 'SMS', colors: 'gris pale, blanc, noir leger', category: 'classique' },
  { name: 'Greystone', code: 'GRS', colors: 'gris uniforme, touches blanches', category: 'classique' },
  { name: 'Oreo', code: 'ORE', colors: 'noir et blanc contraste', category: 'classique' },

  // Tons terre
  { name: 'Saddle Tan', code: 'SDT', colors: 'brun, beige, caramel', category: 'terre' },
  { name: 'Outback', code: 'OTB', colors: 'brun rouge, sable, terre cuite', category: 'terre' },
  { name: 'Sahara', code: 'SAH', colors: 'sable, beige dore, brun clair', category: 'terre' },
  { name: 'Buckskin', code: 'BKS', colors: 'beige chaud, brun, creme', category: 'terre' },
  { name: 'Cappuccino', code: 'CAP', colors: 'brun cafe, creme, beige', category: 'terre' },
  { name: 'Mocha', code: 'MOC', colors: 'brun chocolat, beige, noir', category: 'terre' },

  // Ocean / bleus
  { name: 'Blue Lagoon', code: 'BLG', colors: 'bleu vif, blanc, turquoise', category: 'ocean' },
  { name: 'Caribbean', code: 'CRB', colors: 'bleu tropical, aqua, blanc', category: 'ocean' },
  { name: 'Deep Sea', code: 'DPS', colors: 'bleu fonce, noir, gris bleu', category: 'ocean' },
  { name: 'Tidal Wave', code: 'TDW', colors: 'bleu gris, blanc, ardoise', category: 'ocean' },

  // Modernes
  { name: 'Yukon', code: 'YKN', colors: 'gris bleu, blanc, charcoal', category: 'moderne' },
  { name: 'Mica', code: 'MCA', colors: 'gris argente, blanc nacre, charcoal', category: 'moderne' },
  { name: 'Silverado', code: 'SLV', colors: 'argent, gris pale, blanc', category: 'moderne' },
  { name: 'Graphite', code: 'GPH', colors: 'gris graphite, noir, argent', category: 'moderne' },

  // Premium
  { name: 'Copperhead', code: 'CPH', colors: 'cuivre, brun, rouille metallique', category: 'premium' },
  { name: 'Autumn Blend', code: 'ATB', colors: 'orange automne, brun, rouge', category: 'premium' },
  { name: 'Emerald Coast', code: 'EMC', colors: 'vert emeraude, noir, gris', category: 'premium' },
  { name: 'Canyon Rock', code: 'CNR', colors: 'rouge brique, brun, sable', category: 'premium' },
];

export function getColorsByCategory(category: FlakeColor['category']): FlakeColor[] {
  return FLAKE_COLORS.filter(c => c.category === category);
}

export function searchColors(query: string): FlakeColor[] {
  const q = query.toLowerCase();
  return FLAKE_COLORS.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.colors.toLowerCase().includes(q) ||
    c.category.toLowerCase().includes(q)
  );
}

export function getColorCatalogText(): string {
  const categories: Record<string, string> = {
    classique: 'Classiques (gris/noir/blanc)',
    terre: 'Tons Terre (brun/beige)',
    ocean: 'Ocean / Bleus',
    moderne: 'Modernes (gris contemporain)',
    premium: 'Premium (couleurs speciales)',
  };

  let text = '';
  for (const [cat, label] of Object.entries(categories)) {
    const colors = FLAKE_COLORS.filter(c => c.category === cat);
    text += `\n${label}:\n`;
    text += colors.map(c => `- ${c.name}: ${c.colors}`).join('\n');
  }
  return text;
}
