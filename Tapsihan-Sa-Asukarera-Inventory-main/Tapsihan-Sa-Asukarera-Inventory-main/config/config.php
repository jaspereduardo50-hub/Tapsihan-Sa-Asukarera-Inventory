<?php
// ============================================================
//  TAPSIHAN SA ASUKARERA - configuration
//  Edit the values below. This folder is blocked from the web
//  by config/.htaccess, but never upload this file anywhere public.
// ============================================================
return [
    // Database (XAMPP default is user "root" with an empty password;
    // on Hostinger use the details from hPanel > Databases)
    'db_host' => 'localhost',
    'db_name' => 'tapsihan_inventory',
    'db_user' => 'root',
    'db_pass' => '',

    // One-time key that protects setup/create_accounts.php.
    // Change it to a long random phrase before you open the setup page.
    'setup_key' => 'TapsihanSaAsukareraInventorySAD',

    // Show PHP error details in the browser. Keep false on Hostinger.
    'debug' => false,
];
