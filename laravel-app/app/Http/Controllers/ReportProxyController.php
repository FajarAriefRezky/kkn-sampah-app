<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ReportProxyController extends Controller
{
    protected string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = env('NODE_API_URL', 'https://127.0.0.1:3000');
    }

    protected function httpClient()
    {
        return Http::withOptions([
            'verify' => false,
        ]);
    }

    public function index()
    {
        $response = $this->httpClient()->get($this->baseUrl . '/api/reports');

        return response($response->body(), $response->status())
            ->header('Content-Type', $response->header('Content-Type') ?? 'application/json');
    }

    public function store(Request $request)
    {
        $multipart = [];

        foreach ($request->all() as $key => $value) {
            $multipart[] = [
                'name' => $key,
                'contents' => (string) $value,
            ];
        }

        foreach ($request->allFiles() as $key => $file) {
            $multipart[] = [
                'name' => $key,
                'contents' => fopen($file->getRealPath(), 'r'),
                'filename' => $file->getClientOriginalName(),
                'headers' => [
                    'Content-Type' => $file->getMimeType(),
                ],
            ];
        }

        $response = $this->httpClient()->asMultipart($multipart)->post($this->baseUrl . '/api/reports');

        return response($response->body(), $response->status())
            ->header('Content-Type', $response->header('Content-Type') ?? 'application/json');
    }

    public function updateStatus(Request $request, int $rowNumber)
    {
        $response = $this->httpClient()->post($this->baseUrl . '/api/reports/' . $rowNumber . '/status', [
            'status' => $request->input('status'),
        ]);

        return response($response->body(), $response->status())
            ->header('Content-Type', $response->header('Content-Type') ?? 'application/json');
    }

    public function delete(int $rowNumber)
    {
        $response = $this->httpClient()->post($this->baseUrl . '/api/reports/' . $rowNumber . '/delete');

        return response($response->body(), $response->status())
            ->header('Content-Type', $response->header('Content-Type') ?? 'application/json');
    }
}
