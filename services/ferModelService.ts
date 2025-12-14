import * as tf from '@tensorflow/tfjs';

// FER-2013 labels (7-class): angry, disgust, fear, happy, sad, surprise, neutral
export const FER_LABELS = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];

export async function loadFERModel(url?: string) {
  if (!url) return null;
  try {
    const model = await tf.loadLayersModel(url);
    return model;
  } catch (err) {
    console.warn('Failed loading FER model from url:', url, err);
    return null;
  }
}

export async function predictFER(model: tf.LayersModel | null, imageData: HTMLCanvasElement | ImageData | ImageBitmap): Promise<{ label: string; confidence: number } | null> {
  if (!model) return null;
  try {
    // Convert imageData to tensor
    let tensor: tf.Tensor3D;
    if (imageData instanceof HTMLCanvasElement) {
      tensor = tf.browser.fromPixels(imageData as HTMLCanvasElement);
    } else {
      tensor = tf.browser.fromPixels(imageData as ImageData | ImageBitmap);
    }

    // Convert to grayscale (FER-2013 uses 48x48 grayscale images)
    // Average RGB channels
    const gray = tf.tidy(() => tensor.mean(2).toFloat().expandDims(-1));

    // Resize to 48x48 and normalize to [0,1]
    const resized = tf.image.resizeBilinear(gray, [48, 48]);
    const normalized = resized.div(255.0).reshape([1, 48, 48, 1]);

    const preds = (model.predict(normalized) as tf.Tensor);
    const data = await preds.data();
    const bestIdx = data.indexOf(Math.max(...data));
    const confidence = data[bestIdx] || 0;

    tf.dispose([tensor, gray, resized, normalized, preds]);

    return { label: FER_LABELS[bestIdx] || 'unknown', confidence: Math.round(confidence * 1000) / 10 };
  } catch (err) {
    console.error('FER predict error', err);
    return null;
  }
}
