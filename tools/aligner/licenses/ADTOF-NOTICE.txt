# Attribution and conditions of use

Model: ADTOF Frame_RNN, checkpoint `Frame_RNN_adtofAll_0` from [MZehren/ADTOF](https://github.com/MZehren/ADTOF), commit b3968fb332f69b65ee07c089fc62f436503755db.

## Attribution

This model is a format conversion of the checkpoint released by the authors of:

> M. Zehren, M. Alunno, P. Bientinesi.
> **"High-Quality and Reproducible Automatic Drum Transcription from Crowdsourced Data."**
> Signals 2023, 4(4), 768-787. [doi:10.3390/signals4040042](https://doi.org/10.3390/signals4040042)

> M. Zehren, M. Alunno, P. Bientinesi.
> **"ADTOF: A large dataset of non-synthetic music for automatic drum transcription."**
> Proceedings of the 22nd International Society for Music Information Retrieval Conference (ISMIR), 2021, pp. 818-824.

## Changes made

The TensorFlow checkpoint was converted to ONNX (opset 17). The network was re-implemented in PyTorch with the
checkpoint's weights, and madmom's log-filtered spectrogram (the model's input) was built into the graph, so the file
takes audio samples directly. No weights were modified or fine-tuned. The converted file matches the authors' Keras
model fed with madmom features to within 2e-6 on the test clip. The conversion scripts are in `scripts/drums/` of the
Silly MIDI Tools repository.

## License

The content of the ADTOF repository, and therefore this converted file, is licensed under **CC BY-NC-SA 4.0**:
credit the authors above, use it for non-commercial purposes only, and share any adaptation under the same licence.
