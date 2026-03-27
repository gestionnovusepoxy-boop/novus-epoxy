import { neon } from '@neondatabase/serverless';

const DATABASE_URL = 'postgresql://neondb_owner:npg_NF9cCIr2dfiO@ep-cold-frost-ajdcpqrk.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require';
const sql = neon(DATABASE_URL);

// Step 1: Add type column
await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'residentiel'`;
await sql`CREATE INDEX IF NOT EXISTS idx_crm_leads_type ON crm_leads(type)`;
console.log('Migration done: type column added');

// Step 2: Import leads (filtered: no test entries, no duplicates by email)
const leads = [
  // RÉSIDENTIEL
  { nom: 'Yassine Abid', email: 'abid.yassine@gmail.com', telephone: '(418) 955-4042', ville: 'Québec', notes: "Tapis de pierre a mon entrée — Prochain semaine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Kéven Goupil', email: 'kevengoupil2@gmail.com', telephone: '(581) 989-7483', ville: 'Saint-Apollinaire', notes: "dalle de garage — cette été", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Hamdi Addad', email: 'addad.hamdi@yahoo.com', telephone: '(514) 623-0329', ville: 'Québec', notes: "4 marche a faire de 32\" de largeur — Septembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alain Vaillancourt', email: 'alainvaillan@gmail.com', telephone: '(418) 930-2586', ville: 'Quebec', notes: "Plancher de garage en béton 12x24 pi, 20 ans, bon état — Pas de date particulière", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Anne Guay', email: 'anne.rosaly.1975@outlook.com', telephone: '(418) 903-0978', ville: 'Lévis', notes: "garage — juillet fin", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Stéphanie Grenier', email: 'stephanie@chorusrh.ca', telephone: '(418) 230-9993', ville: 'Sainte Marie', notes: "Entretien de 3 patio extérieur en epoxy — Été 2025", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Denis Paquet', email: 'denpa42@hotmail.com', telephone: '(418) 805-2329', ville: 'Lévis', notes: "Garage patio et portique", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'James Savard', email: 'jamrssavard@live.ca', telephone: '(418) 929-4358', ville: 'Québec', notes: "Escalier et sous-sol entrée de garage + Garage 3 portes — Le plus tôt possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Olivier Rousseau', email: 'oli.rousseau@hotmail.com', telephone: '(581) 991-3227', ville: 'Quebec', notes: "2 perrons en béton à recouvrir — ASAP", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Elliot Bégin', email: 'elliotbegin99@gmail.com', telephone: '(581) 305-3145', ville: 'Quebec', notes: "Commercial — Fin juillet", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Dany Germain', email: 'outils@hotmail.com', telephone: '(418) 647-7936', ville: 'Quebec', notes: "Passage d'immeuble a logement 3'x35' — Août ou septembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marc Parent', email: 'marcparent@hotmail.fr', telephone: '(514) 462-2010', ville: 'Lévis', notes: "2 marches et contre marches environ 50pc — D'ici 3 mois", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Célestin Ntaganzwa', email: 'celestinimmobilier@gmail.com', telephone: '(418) 261-3410', ville: 'Lévis', notes: "garage — cet été", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pascal Rhéaume', email: 'captpascal@hotmail.com', telephone: '(418) 998-4144', ville: 'Quebec', notes: "Reparer et recouvrir galerie extérieure — 2025", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alicia Bédard', email: 'mbedard222@gmail.com', telephone: '(418) 264-7609', ville: 'Quebec', notes: "Plancher cuisine — juillet", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Francisco Rodriguez', email: 'fernike64@hotmail.com', telephone: '(438) 404-5322', ville: 'Quebec', notes: "Aménagement de l'entrée de la maison — Été 2025", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Louis Leclerc', email: 'leclerclouis@hotmail.com', telephone: '(418) 934-4986', ville: 'Québec', notes: "Plancher salon cuisine salle à manger, chalet locatif — Octobre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Olivier Roy', email: 'olicarne@hotmail.com', telephone: '(418) 389-7256', ville: 'Sainte-Marie', notes: "20 par 20 garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie-Josee Vigneault', email: 'suzukixhead@gmail.com', telephone: '(418) 808-0160', ville: 'Quebec', notes: "plancher epoxy sous-sol refait à neuf — automne", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jocelyne Cote', email: 'cotjo18@hotmail.com', telephone: '(418) 930-3525', ville: 'Lévis', notes: "Plancher sous-sol + descente intérieur — août ou début septembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sylvie Martel', email: 'martelsylvie@hotmail.com', telephone: '(418) 523-4348', ville: 'Quebec', notes: "salle de bain, cuisine et hall d'entrée — 3 mois", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pascal Larouche', email: 'plarouche78@gmail.com', telephone: '(418) 265-8282', ville: 'Lévis', notes: "Revetement patio béton commun 12'x28' avec fissures — Le plus tôt possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jean Gosselin', email: 'jeangosselin@live.ca', telephone: '(418) 655-4933', ville: 'Québec', notes: "Plancher cuisine, demande si comptoirs aussi — Dès que possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie-Christine Girard', email: 'mariechristine_girard@hotmail.com', telephone: '(418) 997-3156', ville: 'Quebec', notes: "Plancher au rez-de-chaussée — Peu importe", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jacqueline Veilleux', email: 'jacqueli2014@gmail.com', telephone: '(418) 875-1504', ville: 'Quebec', notes: "Resurfaçage d'un quai de béton — Pas pressé", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Rémi Gignac', email: 'constructionnilor@gmail.com', telephone: '(418) 953-3011', ville: 'Quebec', notes: "520 pi2 plancher garage mécanique amateur — Non déterminé", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Bernadette Khalil', email: 'bernadettekhalil@yahoo.ca', telephone: '(418) 571-8555', ville: 'Quebec', notes: "Garage — Août", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Serge St-Pierre', email: 'sstp@videotron.ca', telephone: '(418) 824-3017', ville: 'Quebec', notes: "balcon extérieure — à déterminer", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Ed Fiz', email: 'edwinf007@hotmail.com', telephone: '(418) 575-7769', ville: 'Quebec', notes: "1200 pied carré — Rapidement", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jeff Labrie', email: 'jeffro0147@gmail.com', telephone: '(581) 305-7459', ville: 'Saint-Damien-De-Buckland', notes: "11x20 sur dalle béton sous-sol à buffer + epoxy Bellechasse — Automne", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Oum Yassir', email: 'oumyassirz@hotmail.fr', telephone: '(418) 265-5667', ville: 'Quebec', notes: "Entrée de maison avec escaliers — Le plus tôt possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Mario Gariépy', email: 'mariogsxr1000@hotmail.com', telephone: '(418) 955-4609', ville: 'Boischatel', notes: "plancher de garage 400 pi2 — maintenant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Joan Simard', email: 'jojosim300@sympatico.ca', telephone: '(418) 872-8280', ville: 'Quebec', notes: "Si epoxy possible sur céramique cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Paule Morin', email: 'paulemorin@ymail.com', telephone: '(418) 886-2880', ville: 'Saint-Antoine-Lotbinière', notes: "perron avant de la maison — durant l'été", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Martin Despres', email: 'abiespopulus@gmail.com', telephone: '(418) 569-0898', ville: 'Saint-Nicolas', notes: "réparation fissures + 400 pi2 garage — octobre/novembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Christian Stephen Koffi', email: 'stefenkeshi4@gmail.com', telephone: '(581) 988-0225', ville: 'Lévis', notes: "Plancher étage — Octobre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Michael Dbe', email: 'miked.qc@gmail.com', telephone: '(418) 255-2892', ville: 'Quebec', notes: "garage 20x24 flocons — Quand disponible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Stéphane Lehoux', email: 'stef_lehoux@hotmail.com', telephone: '(418) 932-1796', ville: 'Saint-Nicolas', notes: "900 pi2 Sous-sol — En août", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Christian Lajoie', email: 'christian.lajoie@outlook.com', telephone: '(418) 576-1285', ville: 'Quebec', notes: "Attend toujours la soumission de Raphaël — Cet été", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sylvie Baron', email: 'sily1961@gmail.com', telephone: '(418) 888-4684', ville: 'Saint-Gilles', notes: "galerie — prochainement", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Djerad', email: 'chdjerad@gmail.com', telephone: '(514) 434-9853', ville: 'Québec', notes: "Appartement sous-sol — Août", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sylvain St-Gelais', email: 'mecsyl69@hotmail.com', telephone: '(581) 443-7650', ville: 'Quebec', notes: "sous-sol +/- 23'x23' — 1 mois max", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Michel Demers', email: 'demers.michel03@gmail.com', telephone: '(581) 986-5641', ville: 'Lévis', notes: "c'est dur à railler — cette année", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Morency Jocelyne', email: 'totoche13@hotmail.com', telephone: '(418) 571-7594', ville: 'Quebec', notes: "sous-sol en ciment — dépend des prix", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Francois Labrousse', email: 'labf867@gmail.com', telephone: '(418) 841-5136', ville: 'Quebec', notes: "Plancher garage à peindre — Pas de date", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Ashraf Heni', email: 'ashraf.heni.1@gmail.com', telephone: '(581) 398-5633', ville: 'Lévis', notes: "Revetement entrée maison — Le plus proche", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Christian Lessard', email: 'christianlessard@hotmail.fr', telephone: '(418) 774-0331', ville: 'Saint-Georges', notes: "6600 pi2 en Beauce — Très bientôt", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Chantal Dion', email: 'michel.timchuck@hotmail.com', telephone: '(581) 983-9244', ville: 'Shannon', notes: "Plancher epoxy garage 16x24 — Août ou septembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Bobby Chernis', email: 'b.chernis@hotmail.ca', telephone: '(418) 844-9922', ville: 'Quebec', notes: "Plancher cuisine escalier", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guesmi Khoubeib', email: 'contact@loursgourmand.com', telephone: '(418) 262-4445', ville: 'Québec', notes: "chambre froide 3200mm*2600mm — 20 août", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Esther Asta', email: 'ezechiel.asta@outlook.com', telephone: '(581) 996-4674', ville: 'Quebec', notes: "epoxy sur balcon — Quand vous pouvez", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Martin Nadeau', email: 'martin@traiteurlebraise.com', telephone: '(418) 570-1699', ville: 'Quebec', notes: "Dalle béton cabanon 10'x24' — Hier", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Joan Leduc', email: 'joanleduc03@gmail.com', telephone: '(418) 410-8443', ville: 'Raymond', notes: "Reprendre 5 marches epoxy fait il y a 3 ans", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Keven Landry', email: 'keven.landry07@gmail.com', telephone: '(418) 571-8809', ville: 'Shannon', notes: "Balcon avant extérieur, 3 escaliers et pallier 8'4\" — Cet été/automne", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Steve Doyon', email: 'stevedoyon@hotmail.com', telephone: '(418) 389-6080', ville: 'Tring-Jonction', notes: "Garage flocons, question si glissant mouillé — Été 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie Gisèle Diby', email: 'damgisele@gmail.com', telephone: '(418) 951-8885', ville: 'Québec', notes: "Sous-sol — Je ne sais pas encore", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Yvon Bourgault', email: 'grafxby@yahoo.ca', telephone: '(418) 209-2634', ville: 'Ste Hénédine', notes: "Galerie béton 8x5, 2 marches, St-Georges — Le plus tôt possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'James Savard', email: 'jamessavard@live.ca', telephone: '(581) 988-6780', ville: 'Québec', notes: "plancher garage 3 portes — quand disponible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Gilles Dumaresq', email: 'dumaresq.gilles0408@gmail.com', telephone: '(581) 309-8511', ville: 'Quebec', notes: "Recouvrir entrée 4'x5' et 2 marches ciment — Quand vous pourrez", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Benjamin Leblanc', email: 'alex_1610@hotmail.com', telephone: '(418) 208-3533', ville: 'Quebec', notes: "plancher epoxy de garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pascale Gagnon-Parent', email: 'pascalegp87@hotmail.com', telephone: '(418) 265-4919', ville: 'Quebec', notes: "Projet salle bain principale", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Rémy Robitaille', email: 'remyrobitaille@hotmail.com', telephone: '(418) 932-6351', ville: 'Quebec', notes: "plancher de garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Fidele Dongmo', email: 'fideledongmo4@gmail.com', telephone: '(418) 255-1846', ville: 'Québec', notes: "escalier", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Clovis Dumas', email: 'clovisdumas4848@gmail.com', telephone: '(418) 572-8728', ville: 'Quebec Ste Foy', notes: "cuisine 25'x8' sur céramique", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Michel Savard', email: 'michesavard@hotmail.com', telephone: '(418) 801-7327', ville: 'Quebec', notes: "Garage 20x20", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marilyn Gauvin', email: 'magauvin2001@hotmail.com', telephone: '(418) 559-1016', ville: 'Quebec', notes: "Rallonge de maison 15X15", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Rejean Bolduc', email: 'bolduc223@hotmail.com', telephone: '(418) 844-3416', ville: 'Shannon', notes: "cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Rejean Boudreault', email: 'reboudreau@hotmail.com', telephone: '(418) 998-4353', ville: 'Boischatel', notes: "tour de piscine creusée", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'David Tessier', email: 'david@prae.ca', telephone: '(418) 284-1364', ville: 'Shannon', notes: "Garage résidentiel 1300 pc", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pierre-David Cloutier', email: 'pcloutier81@hotmail.com', telephone: '(418) 806-7677', ville: 'Québec', notes: "Epoxy garage 600pi2", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Thibault Thomas', email: 'thomas.thibault@gmail.com', telephone: '(418) 717-9634', ville: 'Quebec', notes: "Epoxy", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sébastien Guay', email: 'seb_guay@hotmail.ca', telephone: '(581) 995-5611', ville: 'Sainte-Anne-De-Beaupré', notes: "Réparation béton + enduit 2 galeries extérieures", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Patrice Duhamel', email: 'duhamel.patrice@gmail.com', telephone: '(418) 576-4904', ville: 'Quebec', notes: "Réparer et recouvrir 2 perrons de portes", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Eric Desbiens', email: 'hedesbiens@icloud.com', telephone: '(418) 815-3501', ville: 'Baie-Saint-Paul', notes: "Epoxy grandeur maison sur dalle béton", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guy Allard', email: 'guyall@live.fr', telephone: '(418) 433-0662', ville: 'St-Apollinaire', notes: "balcon epoxy + 2 voisins", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marc Veilleux', email: 'mav284@hotmail.com', telephone: '(418) 809-9981', ville: 'Saint-Augustin De Desmaures', notes: "Perron avant + dalle béton arrière pour table/spa — premier contact", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Samuel Joly', email: 'samuel_joly@hotmail.com', telephone: '(418) 271-2681', ville: 'Quebec', notes: "277 pi2 sur céramique rdc", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guillaire Douanla', email: 'guilary@yahoo.fr', telephone: '(581) 578-0197', ville: 'Québec', notes: "garage et salle machine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Mouna Khalifi', email: 'khalifimouna@hotmail.com', telephone: '(418) 930-6657', ville: 'Lévis', notes: "intérieur rez-de-chaussée", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Lucie Veilleux', email: 'lucieveilleux68@gmail.com', telephone: '(418) 655-2095', ville: 'Québec', notes: "Cuisine et sao", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jean-Yves Turmel', email: 'jturmelbuckland@gmail.com', telephone: '(418) 955-4707', ville: 'Levis', notes: "palier 8'x4'x7\" + 2 marches", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Michael Marois', email: 'michaelmarois23@gmail.com', telephone: '(418) 254-1223', ville: 'Quebec', notes: "plancher cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Chloé Chamard', email: 'chloechamard@icloud.com', telephone: '(418) 271-1835', ville: 'Quebec', notes: "Plancher condo 3 1/2", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Yanik Hardy', email: 'hardy.yanik@hotmail.com', telephone: '(418) 283-3919', ville: 'Beaumont', notes: "garage ~300pi2 béton 1988 avec craques, flakes noirs ou argentés", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Luc Richard', email: 'luc@placementlr.com', telephone: '(819) 352-4658', ville: 'Blandford', notes: "Plancher garage double", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Claude Lavoie', email: 'lavoieclaude6@gmail.com', telephone: '(418) 953-0588', ville: 'Beauport', notes: "Sous-sol plancher chauffant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guylaine Guay', email: 'guylainegg2806@gmail.com', telephone: '(418) 435-1668', ville: 'Baie-Saint-Paul', notes: "Cuisine et salle à manger epoxy par-dessus céramiques", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Louis Francois Roy', email: 'f-1tech@hotmail.com', telephone: '(418) 802-0324', ville: 'Lévis', notes: "Garage 24X30", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pierre Tremblay', email: 'pierretremblay14@hotmail.com', telephone: '(418) 580-4302', ville: 'Chateau Richer', notes: "Plancher garage 26'x30'", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Nadine Martel', email: 'nadine.martel@live.ca', telephone: '(418) 573-3337', ville: 'Quebec', notes: "Garage intérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Dany Gagné', email: 'dgagne4029@gmail.com', telephone: '(581) 309-9297', ville: 'Lévis', notes: "Le balcon avant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Albo Electrique', email: 'alex@alboelectrique.ca', telephone: '(418) 953-2022', ville: 'Quebec', notes: "plancher de commerce", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie-Claude Lachance', email: 'mclach32437@gmail.com', telephone: '(418) 932-1251', ville: 'Quebec', notes: "Plancher de cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Lise Vallières', email: 'lisevall@hotmail.com', telephone: '(418) 806-4881', ville: 'Saint Bernard', notes: "Galerie extérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Catherine Goulet-Leclerc', email: 'catherine.goulet90@hotmail.com', telephone: '(418) 559-7089', ville: 'Saint-Augustin-De-Desmaures', notes: "Garage en epoxy!", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jocelyne Villeneuve', email: 'villeneuve18@hotmail.com', telephone: '(418) 456-6599', ville: 'Quebec', notes: "2 salles de bains et plancher cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guillaume Michaud', email: 'g.michaud@wholesale-express.com', telephone: '(418) 571-5090', ville: 'Quebec', notes: "Epoxy plancher garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alain Nadeau', email: 'alnadeau79@hotmail.com', telephone: '(418) 882-8398', ville: 'Sainte-Marie', notes: "epoxy sur patio béton", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie Couillard', email: 'mariehlneh@oricom.ca', telephone: '(418) 833-7521', ville: 'Lévis', notes: "nouvelle pièce 15x19 — hésitent sur finition", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Thérèse Simard', email: 'therese.5611@gmail.com', telephone: '(418) 999-8459', ville: 'Saint-Augustin-De-Desmaures', notes: "Epoxy intérieur condo?", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Bernard Gagné', email: 'bgagne1@sympatico.ca', telephone: '(418) 254-5554', ville: 'Quebec', notes: "Hall d'entrée building", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jeson Boulay Robitaille', email: 'jesonbr@outlook.com', telephone: '(581) 888-0825', ville: 'Quebec', notes: "refaire epoxy déjà en place", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Stéphanie Giguère', email: 'stephgiguere@icloud.com', telephone: '(418) 654-5205', ville: 'Québec', notes: "Sous-sol complet chalet 28x28", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jean-Claude Fecteau', email: 'jcfecteau@outlook.com', telephone: '(418) 456-2087', ville: 'Saint Bernard', notes: "Sous-sol", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie Claude Fournier', email: 'mc.fournier@videotron.ca', telephone: '(418) 951-3461', ville: 'Quebec', notes: "Entrée maison perron 7'x10'", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Bettey Ginette', email: 'gbettey@live.ca', telephone: '(418) 832-6062', ville: 'Charny', notes: "2 pièces: sous-sol et verrière", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Angele Leblond Grenier', email: 'angelegreangelegreniernier@axion.ca', telephone: '(418) 596-2028', ville: 'St-Sylvestre', notes: "plancher épicerie", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Dany Quinton', email: 'quincy1973@gmail.com', telephone: '(418) 386-6100', ville: 'Vallée Jonction', notes: "?????", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alexandre Baron', email: 'alexandre_baron@hotmail.ca', telephone: '(418) 930-8201', ville: 'Saint-Tite-Des-Caps', notes: "Plancher epoxy garage 24x28", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Mélanie Lepage', email: 'melanienlepage@gmail.com', telephone: '(418) 951-8438', ville: 'Quebec', notes: "plancher cuisine 16x14", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Miguel', email: 'miguel.miranda90@gmail.com', telephone: '(514) 588-6174', ville: 'Québec', notes: "Janvier — Décembre 2025", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Ludo Plante', email: 'ludoplante@gmail.com', telephone: '(418) 262-9496', ville: 'Québec', notes: "1er mai 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'JeanBerube', email: 'berube20@aclou.com', telephone: '(819) 629-4116', ville: 'Saint-Bruno-De-Guigues', notes: "Mi-décembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Genny Tous', email: 'gennytous@hotmail.com', telephone: '(819) 269-1369', ville: 'Trois-Rivières', notes: "15 Dec", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Stephanie Jeanson', email: 'octopusgranby@hotmail.fr', telephone: '(450) 775-1336', ville: 'St Ludger', notes: "??", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jean-Marc Hamel', email: 'hamel.jean-marc@videotron.ca', telephone: '(418) 622-0611', ville: 'Québec', notes: "Pas d'importance", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Tina Alliche', email: 'allichetina@gmail.com', telephone: '(418) 255-2685', ville: 'Lévis', notes: "à partir de janvier", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Diane Michaud', email: 'michauddiane@msn.com', telephone: '(418) 508-0824', ville: 'Saint-Cyrille', notes: "Dès que possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Denis Houle', email: 'denishoule72@hotmail.com', telephone: '(418) 956-4247', ville: 'Boischatel', notes: "Maintenant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Joanie Vallières', email: 'joanievallieres@hotmail.com', telephone: '(581) 307-0806', ville: 'Quebec', notes: "Epoxy sur dalle garage — 2 semaines", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Josée-Anne', email: 'joloup@hotmail.com', telephone: '(418) 826-0768', ville: 'Quebec', notes: "garage double 24x28 — Mai 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Robert Lemay', email: 'boblemay73@live.ca', telephone: '(418) 263-8585', ville: 'Lévis', notes: "Sous-sol chalet — Début d'année", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Réjean Duchesneau', email: 'ranchyorej@gmail.com', telephone: '(418) 575-3147', ville: 'Quebec', notes: "sous-sol — 25 Nov", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guillaume Bertrand', email: 'guillaume0901@hotmail.com', telephone: '(581) 745-8882', ville: 'Stoneham', notes: "Mon sous-sol — Le plus tôt possible", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marco Caron', email: 'marco020968@outlook.com', telephone: '(418) 230-9353', ville: 'Saint Georges De Beauce', notes: "24x32 epoxy avec drainage — Printemps", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sylvie Lavallée Légaré', email: 'revie2010.sl@gmail.com', telephone: '(514) 943-1375', ville: 'Villeroy', notes: "sous-sol maison neuve ~1472 pc — 2025.12.15", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Caroline Pauzé', email: 'carolinepauze@gmail.com', telephone: '(819) 816-1983', ville: 'Lac Etchemin', notes: "recouvrement étage 40x30 sur veneer — mai", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Angie Pabon', email: 'angieliz11@hotmail.com', telephone: '(514) 686-8140', ville: 'Sainte-Catherine', notes: "Garage 2 places — 2 semaines", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Maxym Burton', email: 'maxburton9@gmail.com', telephone: '(819) 500-2553', ville: 'Gatineau', notes: "plancher sous-sol — fin nov/mi-déc", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Taormina Mady', email: 'mady.taormina@hotmail.com', telephone: '(418) 998-8434', ville: 'Stoneham', notes: "3 chambres marqueterie + plancher céramique salon/cuisine — été 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Raynald Caron', email: 'rouanne@globetroter.net', telephone: '(418) 241-6506', ville: 'Saint-Pierre', notes: "Cuisine et salon — Janvier ou février", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Julie Rodrigue', email: 'julierodrigue13@hotmail.ca', telephone: '(450) 750-5687', ville: 'Lévis', notes: "2 pièces + passage sous-sol, peut-être salle de bain — dès que possible/début 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Denis Cayer', email: 'deniscayer@me.com', telephone: '(418) 873-5454', ville: 'Raymond', notes: "solarium 14x40 en interbloc — Printemps 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Melanie Fournier', email: 'melanox777@live.com', telephone: '(438) 889-9279', ville: 'Québec', notes: "sous-sol — bientôt", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Janvier', email: 'soniaorly@yahoo.com', telephone: '(438) 509-2774', ville: 'Laprairie', notes: "Corridor escaliers et sous-sol — Quand vous voulez", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'David Bergeron', email: 'divadb@live.ca', telephone: '(819) 996-6600', ville: 'Louiseville', notes: "epoxy plancher maison 24x40 et garage 30x40 — décembre", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie Helene Juneau', email: 'mariehelenejuneau@hotmail.ca', telephone: '(418) 563-1896', ville: 'Stoneham-Et-Tewkesbury', notes: "Plancher cuisine — Avant Noël", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Francine Routhier', email: 'franclo2022@icloud.com', telephone: '(418) 331-2595', ville: 'Thetford Mines', notes: "1065 pi2 garage 1 an — Pas de date", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Danielle Giroux', email: 'dan_giroux28@icloud.com', telephone: '(418) 842-4833', ville: 'Québec', notes: "Entrée intérieure — Printemps 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alexandre Girard', email: 'alexandre042@cgocable.ca', telephone: '(418) 480-7395', ville: 'Alma', notes: "Garage 28x28 à Alma — Printemps", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Andre Beaulieu', email: 'teufxrs@sympatico.ca', telephone: '(418) 952-2096', ville: 'Shannon', notes: "chambre 11x11 — dépend du prix", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Ahlem Chalbi', email: 'oulaouma64@gmail.com', telephone: '(418) 264-5251', ville: 'Quebec', notes: "Rez-de-chaussée — Hiver", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Josée Nault-Bill', email: 'ranch_jo_bill@hotmail.com', telephone: '(819) 350-3876', ville: 'Victoriaville', notes: "Pas de date", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Ophelie Mengue', email: 'opheliemengue28@gmail.com', telephone: '(438) 878-7210', ville: 'Quebec', notes: "Mai", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Steeve Marcoux', email: 'steevem@hotmail.com', telephone: '(418) 387-6669', ville: 'Sainte-Marie', notes: "Selon les disponibilités", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Igorboy', email: 'igojenny@yahoo.fr', telephone: '(581) 995-1111', ville: 'Quebec', notes: "March", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Andre Therrien', email: 'andretherrien62@gmail.com', telephone: '(418) 953-5977', ville: 'Quebec', notes: "Pas date précise", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Daniel St-Jean', email: 'danielstjean.bellemare@gmail.com', telephone: '(819) 692-2753', ville: 'Trois-Rivières', notes: "2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Benoit Trussart', email: 'trussartb24@gmail.com', telephone: '(581) 992-0595', ville: 'Saint-Raphaël', notes: "Plancher cabane à sucre — Juin", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Isabelle Taillon', email: 'i.taillonqc@gmail.com', telephone: '(418) 573-8210', ville: 'Quebec', notes: "Garage 14x20 — Fin fév/début mars", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Nathalie Rioux', email: 'nrioux007@outlook.com', telephone: '(418) 955-9984', ville: 'Lévis', notes: "cuisine", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Simon Tremblay', email: 'sim_tremblay@hotmail.com', telephone: '(418) 997-7770', ville: 'Quebec', notes: "Garage 14x24 — Été", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Danielle Martel', email: 'jeanbedard1952@hotmail.com', telephone: '(418) 558-5105', ville: 'Quebec', notes: "été 2026", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Josée Dumont', email: 'electromarkv@hotmail.com', telephone: '(418) 284-3947', ville: 'Quebec', notes: "À voir", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Yves Paquin', email: 'yvespaquin1963@gmail.com', telephone: '(418) 507-3369', ville: 'Sainte-Thècle', notes: "plancher salle de douche — janvier", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jean-Francois Crawford', email: 'entretiencrawfordetfils@gmail.com', telephone: '(418) 930-3188', ville: 'Quebec', notes: "Estimation avant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Denis Gignac', email: 'denisglynef@hotmail.com', telephone: '(581) 995-1824', ville: 'Québec', notes: "Sous-sol — Janvier et février", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Dler Alix', email: 'alisma.dler92@gmail.com', telephone: '(438) 993-3061', ville: 'Laval', notes: "extérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Pierre-Francine Savard', email: 'francine-1957@hotmail.com', telephone: '(514) 715-4939', ville: 'Repentigny', notes: "Repentigny", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Gaétan Dumont', email: 'patetbidou16@hotmail.com', telephone: '(418) 851-5851', ville: 'Trois-Pistoles', notes: "Garage plancher de bois", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Rejean Gagnon', email: 'r.gagon@hotmail.com', telephone: '(581) 306-6139', ville: 'La Baie', notes: "611 pi2 maison neuve Saguenay", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Johanne Proteau', email: 'johanne.proteau1@gmail.coml', telephone: '(418) 841-1710', ville: 'Quebec', notes: "350 pi2 hall+sdb+cuisine+salon sur céramique 25 ans", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Suzanne Gagnon', email: 'suzannegagnon1958@hotmail.fr', telephone: '(418) 763-5676', ville: 'Sainte-Anne-Des-Monts', notes: "cuisine à quel prix", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Christian Dinel', email: 'dinelchristian44@gmail.com', telephone: '(418) 571-7969', ville: 'Quebec', notes: "Planchers cuisine, porte d'entrée, perron avant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sylvain Millette', email: 'garsdebois2242@hotmail.com', telephone: '(418) 956-5254', ville: 'Raymond', notes: "Garage 12x29 annexé à la maison", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'David Grenier', email: 'davou71@hotmail.com', telephone: '(418) 803-7450', ville: 'Quebec', notes: "refaire plancher sous-sol restaurant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Marie-Pier Giroux Maheux', email: 'mariepier_giroux@hotmail.com', telephone: '(581) 888-6511', ville: 'Lévis', notes: "Garage 14x32 et garage excavé même dimension", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Lise Boivin', email: 'boivinlise5@gmail.com', telephone: '(418) 208-2350', ville: 'Saint-Apollinaire', notes: "sous-sol", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Audrey Angela', email: 'audreykamto@gmail.com', telephone: '(416) 771-1422', ville: 'Ottawa Orléans', notes: "garage 1 car à Ottawa", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Guerby', email: 'guerbyp03@gmail.com', telephone: '(873) 989-0660', ville: 'Sherbrooke', notes: "entrée stationnement", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Jimy Carrier', email: 'osiris69@hotmail.ca', telephone: '(418) 558-8312', ville: 'Quebec', notes: "terrasse extérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Von Carlos', email: 'carlos.qc.ca@hotmail.com', telephone: '(819) 350-3405', ville: 'St Louis De Blandford', notes: "plancher garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Tomy Richer', email: 'tomthetrainer@hotmail.com', telephone: '(514) 796-8669', ville: 'Montreal', notes: "1000 pi2, dalle neuve. Gris métallique.", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Richard Fleury', email: 'richardfleury1008@icloud.com', telephone: '(418) 720-3456', ville: 'Alma', notes: "Lac St-Jean", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Simon Lehoux', email: 'simon.lehoux@gmail.com', telephone: '(418) 809-6468', ville: 'Quebec', notes: "Plancher garage 22x22 avec plinthes remontées", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Mathieu Coulombe', email: 'matcoul88@hotmail.com', telephone: '(418) 655-6942', ville: 'Quebec', notes: "Refaire balcon entrée devant maison", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Sarah Youssef', email: 'youssefsarah@gmail.com', telephone: '(514) 799-7924', ville: 'Laval', notes: "Garage et patio", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Bertrand Bernard', email: 'bbernard1955@outlook.com', telephone: '(450) 346-9952', ville: 'Lambton', notes: "salle de bain 9x14 sur veneer", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Hayssam El-Safah', email: 'haysami@hotmail.com', telephone: '(819) 609-7229', ville: 'Trois-Rivières', notes: "réparation ciment entrée maison", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Alain Blanchet', email: 'blanchetalain426@hotmail.com', telephone: '(418) 952-7278', ville: 'Quebec', notes: "Patio 18x35 extérieur à couvrir", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Max Trudel', email: 'trudelm@hotmail.com', telephone: '(581) 999-9000', ville: 'Quebec', notes: "Garage 26x27 extérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Louis Kimpton', email: 'louiskimpton@videotron.ca', telephone: '(438) 938-3598', ville: 'Sainte-Thérèse', notes: "Prix au pi2 (250 pi2)", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Patrick Bourassa', email: 'patrick.bourassa59@gmail.com', telephone: '(418) 571-1303', ville: 'Beauport', notes: "Entrée avec marche en béton", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Christiane René-Tousignant', email: 'kikitou60@icloud.com', telephone: '(450) 516-0898', ville: 'Mirabel', notes: "Plancher béton véranda 12x15", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Benoit Perrier', email: 'benperrier1@hotmail.com', telephone: '(418) 987-5363', ville: 'Saint-Raymond', notes: "Garage", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Remy Gaudreault', email: 'cjrg1320@gmail.com', telephone: '(418) 633-4336', ville: 'Notre-Dame-Des-Monts', notes: "Plancher salon et salle à manger", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Levis Bilodeau', email: 'levisetcacole@hotmail.com', telephone: '(418) 256-3724', ville: 'La Dorée', notes: "Recouvrir galerie béton extérieur", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Roger Carole Ouellet', email: 'caroger1@live.ca', telephone: '(418) 661-4964', ville: 'Quebec Beauport', notes: "~400 pi2 plancher intérieur solarium + extérieur, béton neuf avec scellant", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Biley', email: 'jbiley@hotmail.com', telephone: '(514) 969-6504', ville: 'Vaudreuil-Dorion', notes: "Revêtement de béton", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Djazi Imad', email: 'iimad.djazipro@gmail.com', telephone: '(450) 494-4779', ville: 'Casablanca', notes: "Epoxy fondation", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Martine Gagnon', email: 'camya_comoesta@hotmail.com', telephone: '(581) 982-6637', ville: 'Lévis', notes: ".", source: 'cloud', type: 'residentiel', service: 'Résidentiel' },
  { nom: 'Hamza Ousji', email: 'ousjihamza@gmail.com', telephone: '(418) 953-0683', ville: 'Quebec', notes: "Changement plancher étage — Début novembre", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Aurelie Perennec François', email: 'aurelief29@gmail.com', telephone: '(581) 980-4819', ville: 'Québec', notes: "60m2 à poser — dès que possible", source: 'cloud', type: 'commercial', service: 'Commercial' },

  // COMMERCIAL
  { nom: 'Steve Montreuil', email: 'stevemontreuil@outlook.fr', telephone: '', ville: 'Bécancour', notes: "Terrasse 20x20 — Plus rapidement possible", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Marc Forgues', email: 'cramforg@hotmail.com', telephone: '(819) 716-9265', ville: 'Asbestos', notes: "Sous-sol église environ 30X40", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Dylan Frenette', email: 'dfperformance@hotmail.com', telephone: '(418) 928-5793', ville: 'Ancienne Lorette', notes: "Local 1350 pi2 — N'importe quand", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Sonia Nadeau', email: 'sonianadeau06@gmail.com', telephone: '(418) 313-3355', ville: 'Lac Etchemin', notes: "Garage pension animaux 36x20 — L'année prochaine", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Yanick Nolin', email: 'darkkcinay@hotmail.com', telephone: '(418) 262-5855', ville: 'Quebec', notes: "Plancher petit salon de coiffure — Infos seulement", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Roger Lahaie', email: 'lahaie501@gmail.com', telephone: '(819) 989-1444', ville: 'St-Tite', notes: "sous-sol 40x20 — 19 sept", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Nana Armelle', email: 'armellenana@yahoo.fr', telephone: '(581) 999-8022', ville: 'Quebec', notes: "rénovation sous-sol + 2 chambres — en septembre", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Sabiha Meziani', email: 'royallps01@gmail.com', telephone: '(581) 982-6313', ville: 'Quebec', notes: "Plancher garage — Le plus tôt possible", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Artisans Rénovateurs', email: 'danybeaudoin00@hotmail.fr', telephone: '(819) 350-0787', ville: 'Plessisville', notes: "Job au lac Nicolet ~700 pi2 — Cet automne", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Claude Morin, Directeur Général', email: 'cmorin@saint-raphael.ca', telephone: '(581) 985-9854', ville: 'Saint-Raphaël', notes: "Plancher de caserne — Dès maintenant", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Anita Gagnon', email: 'anitte_g@hotmail.com', telephone: '(418) 952-6971', ville: 'Québec', notes: "Garage et sous-sol — Décembre ou janvier", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Isabelle Francis', email: 'francisisabelle@hotmail.com', telephone: '(581) 922-8413', ville: 'Quebec', notes: "rez-de-chaussée — novembre", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Pierre Dubois', email: 'pierredubois1953@hotmail.com', telephone: '(418) 814-0040', ville: 'Thetford Mines', notes: "Plancher rdc 700 pi2 — Avant décembre", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Pierrot Dufour', email: 'pierrotdufour17@hotmail.com', telephone: '(418) 805-1668', ville: 'Quebec', notes: "Cuisine salon couloir — Indéterminé", source: 'cloud', type: 'commercial', service: 'Commercial' },
  { nom: 'Mustapha Lounis', email: 'lounis.mustapha@gmail.com', telephone: '', ville: 'Quebec', notes: "Repavage entrée garage 590 pi2 — Début septembre", source: 'cloud', type: 'commercial', service: 'Commercial' },
];

// Deduplicate by email
const seen = new Set();
const unique = leads.filter(l => {
  if (!l.email || seen.has(l.email.toLowerCase())) return false;
  seen.add(l.email.toLowerCase());
  return true;
});

// Check existing emails to avoid duplicates with DB
const existing = await sql`SELECT email FROM crm_leads WHERE email IS NOT NULL`;
const existingEmails = new Set(existing.map(r => r.email?.toLowerCase()));
const toInsert = unique.filter(l => !existingEmails.has(l.email.toLowerCase()));

console.log(`Total leads from Cloud: ${leads.length}`);
console.log(`After dedup: ${unique.length}`);
console.log(`Already in DB: ${unique.length - toInsert.length}`);
console.log(`To insert: ${toInsert.length}`);

let inserted = 0;
for (const l of toInsert) {
  await sql`INSERT INTO crm_leads (nom, email, telephone, ville, notes, source, type, service, statut, temperature)
    VALUES (${l.nom}, ${l.email}, ${l.telephone}, ${l.ville}, ${l.notes}, ${l.source}, ${l.type}, ${l.service}, 'nouveau', 'tiede')`;
  inserted++;
}

console.log(`\nInserted: ${inserted} leads`);

// Summary
const res = await sql`SELECT type, COUNT(*) as count FROM crm_leads WHERE source = 'cloud' GROUP BY type`;
console.log('\nCloud leads by type:');
for (const r of res) {
  console.log(`  ${r.type}: ${r.count}`);
}

const total = await sql`SELECT COUNT(*) as count FROM crm_leads`;
console.log(`\nTotal leads in CRM: ${total[0].count}`);
