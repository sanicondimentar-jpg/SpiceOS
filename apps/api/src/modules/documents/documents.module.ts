import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { GoogleDriveController } from './google-drive/google-drive.controller';
import { DriveSyncService } from './google-drive/drive-sync.service';

@Module({
  controllers: [GoogleDriveController],
  providers: [DocumentsService, GoogleDriveClient, DriveSyncService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
