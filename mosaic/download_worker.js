// download_worker.js
// JPEGエンコード処理（F3-B）をメインスレッドから切り離す専用Worker

self.onmessage = async (e) => {
    // ★ 修正: 'canvas' (OffscreenCanvas) を受け取る
    const { canvas, quality } = e.data; 
    
    if (!canvas || typeof canvas.getContext !== 'function') {
        self.postMessage({ type: 'error', message: 'OffscreenCanvas not transferred correctly.' });
        return;
    }

    try {
        // OffscreenCanvasは既に描画済みなので、そのまま利用する
        
        // ★ 計測開始: JPEGエンコードの純粋な計算時間を測定
        const t_encode_start = performance.now();
        
        // 実際のJPEGエンコード処理
        // OffscreenCanvas上で直接convertToBlobを実行
        const blob = await canvas.convertToBlob({ 
            type: 'image/jpeg',
            quality: quality
        });
        
        const t_encode_end = performance.now();
        const encodeTime = t_encode_end - t_encode_start;

        // メインスレッドにBlobとエンコード時間を返送
        // Blobを転送可能オブジェクトとして渡す
        self.postMessage({ 
            type: 'complete', 
            blob: blob,
            encodeTime: encodeTime / 1000.0 // 秒単位で報告
        }, [blob]); 
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Encoding failed: ${error.message}` });
    }
};
