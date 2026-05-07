-- Migration 027: Ajouter vinyl_click à la contrainte type_service sur quotes
-- Le CHECK sur quotes.type_service limitait à flake/metallique/commercial — élargi à tous les services

-- Drop l'ancienne contrainte
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_type_service_check;

-- Recréer sans contrainte enum — la validation se fait dans l'app (SERVICES object dans pricing.ts)
-- Plus flexible pour les futurs services
ALTER TABLE quotes ALTER COLUMN type_service TYPE VARCHAR(40);
