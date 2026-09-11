<?php

use Phinx\Migration\AbstractMigration;

/** @phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace */
class AddMonitoringCameras extends AbstractMigration
{
    public function change(): void
    {
        $this->table('monitoringcamera', ['id' => 'cameraId'])
            ->addColumn('displayId', 'integer')
            ->addColumn('name', 'string', ['limit' => 100])
            ->addColumn('latitude', 'decimal', ['precision' => 10, 'scale' => 7])
            ->addColumn('longitude', 'decimal', ['precision' => 10, 'scale' => 7])
            ->addColumn('playbackUrl', 'text')
            ->addIndex(['displayId'])
            ->addForeignKey('displayId', 'display', 'displayId', ['delete' => 'CASCADE'])
            ->create();
    }
}
