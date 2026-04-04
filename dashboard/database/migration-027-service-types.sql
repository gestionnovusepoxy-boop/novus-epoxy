-- Expand type_service check to include all 7 service types
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_type_service_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_type_service_check
  CHECK (type_service IN ('flake','metallique','couleur_unie','quartz','antiderapant','commercial','meulage'));
