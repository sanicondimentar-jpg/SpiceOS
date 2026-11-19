import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { DocumentsLibraryService } from './documents-library.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { GoogleDriveController } from './google-drive/google-drive.controller';
import { DriveSyncService } from './google-drive/drive-sync.service';

@Module({
  imports: [KnowledgeModule],
  controllers: [GoogleDriveController, DocumentsController],
  providers: [DocumentsService, DocumentsLibraryService, GoogleDriveClient, DriveSyncService],
  exports: [DocumentsService, DocumentsLibraryService],
})
export class DocumentsModule {}
