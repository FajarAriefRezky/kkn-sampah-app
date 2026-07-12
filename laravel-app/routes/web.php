<?php

use App\Http\Controllers\ReportProxyController;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('dashboard');
});

Route::withoutMiddleware([VerifyCsrfToken::class])->group(function () {
    Route::get('/api/reports', [ReportProxyController::class, 'index']);
    Route::post('/api/reports', [ReportProxyController::class, 'store']);
    Route::post('/api/reports/{rowNumber}/status', [ReportProxyController::class, 'updateStatus']);
    Route::post('/api/reports/{rowNumber}/delete', [ReportProxyController::class, 'delete']);
});
