// download_worker.js
// JPEGエンコード処理（F3-B）をメインスレッドから切り離す専用Worker

self.onmessage = async (e) => {
    const { imageBitmap, quality } = e.data;
    
    if (!imageBitmap || typeof imageBitmap.close !== 'function') {
        self.postMessage({ type: 'error', message: 'ImageBitmap not transferred correctly.' });
        return;
    }

    try {
        // ImageBitmapから一時的なCanvasを作成（エンコードに必要）
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0);

        // ★ 計測開始: JPEGエンコードの純粋な計算時間を測定
        const t_encode_start = performance.now();
        
        // 実際のJPEGエンコード処理
        const blob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: quality
        });
        
        const t_encode_end = performance.now();
        const encodeTime = t_encode_end - t_encode_start;

        // ImageBitmapとOffscreenCanvasはメモリから解放
        imageBitmap.close();
        
        // メインスレッドにBlobとエンコード時間を返送
        self.postMessage({ 
            type: 'complete', 
            blob: blob,
            encodeTime: encodeTime / 1000.0 // 秒単位で報告
        }, [blob]); // Blobを転送可能オブジェクトとして渡す
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Encoding failed: ${error.message}` });
    }
};
