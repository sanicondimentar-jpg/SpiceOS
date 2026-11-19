-- Documentos subidos desde SpiceOS: el archivo se guarda en la base (en producción no hay almacenamiento de objetos), igual que los comprobantes.
ALTER TABLE "document_versions" ADD COLUMN "content" BYTEA;
ALTER TABLE "document_versions" ADD COLUMN "file_name" TEXT;
ALTER TABLE "document_versions" ADD COLUMN "size_bytes" INTEGER;
