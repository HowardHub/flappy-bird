// Simple Neural Network for Neuroevolution
// No backpropagation needed, just mutation

export class NeuralNetwork {
  inputNodes: number;
  hiddenNodes: number;
  outputNodes: number;
  weightsIH: number[][]; // Input -> Hidden
  weightsHO: number[][]; // Hidden -> Output
  biasH: number[];       // Hidden Biases
  biasO: number[];       // Output Biases

  constructor(inputNodes: number, hiddenNodes: number, outputNodes: number) {
    this.inputNodes = inputNodes;
    this.hiddenNodes = hiddenNodes;
    this.outputNodes = outputNodes;

    this.weightsIH = Array(this.inputNodes).fill(0).map(() => Array(this.hiddenNodes).fill(0).map(() => Math.random() * 2 - 1));
    this.weightsHO = Array(this.hiddenNodes).fill(0).map(() => Array(this.outputNodes).fill(0).map(() => Math.random() * 2 - 1));
    this.biasH = Array(this.hiddenNodes).fill(0).map(() => Math.random() * 2 - 1);
    this.biasO = Array(this.outputNodes).fill(0).map(() => Math.random() * 2 - 1);
  }

  predict(inputs: number[]): number[] {
    // Hidden Layer
    let hidden = Array(this.hiddenNodes).fill(0);
    for (let j = 0; j < this.hiddenNodes; j++) {
      let sum = 0;
      for (let i = 0; i < this.inputNodes; i++) {
        sum += inputs[i] * this.weightsIH[i][j];
      }
      sum += this.biasH[j];
      hidden[j] = this.sigmoid(sum);
    }

    // Output Layer
    let outputs = Array(this.outputNodes).fill(0);
    for (let k = 0; k < this.outputNodes; k++) {
      let sum = 0;
      for (let j = 0; j < this.hiddenNodes; j++) {
        sum += hidden[j] * this.weightsHO[j][k];
      }
      sum += this.biasO[k];
      outputs[k] = this.sigmoid(sum);
    }

    return outputs;
  }

  copy(): NeuralNetwork {
    const nn = new NeuralNetwork(this.inputNodes, this.hiddenNodes, this.outputNodes);
    nn.weightsIH = this.weightsIH.map(row => [...row]);
    nn.weightsHO = this.weightsHO.map(row => [...row]);
    nn.biasH = [...this.biasH];
    nn.biasO = [...this.biasO];
    return nn;
  }



  mutate(rate: number) {
    const mutateValue = (val: number) => {
      if (Math.random() < rate) {
        // 5% chance of larger mutation to escape local optima (Dynamic Mutation)
        if (Math.random() < 0.05) {
           return val + (Math.random() * 1.0 - 0.5); 
        }
        // Standard mutation: small drift for fine-tuning
        return val + (Math.random() * 0.2 - 0.1);
      }
      return val;
    };

    this.weightsIH = this.weightsIH.map(row => row.map(mutateValue));
    this.weightsHO = this.weightsHO.map(row => row.map(mutateValue));
    this.biasH = this.biasH.map(mutateValue);
    this.biasO = this.biasO.map(mutateValue);
  }

  sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  toJSON(): any {
    return {
      inputNodes: this.inputNodes,
      hiddenNodes: this.hiddenNodes,
      outputNodes: this.outputNodes,
      weightsIH: this.weightsIH,
      weightsHO: this.weightsHO,
      biasH: this.biasH,
      biasO: this.biasO
    };
  }

  static fromJSON(data: any): NeuralNetwork {
    const nn = new NeuralNetwork(data.inputNodes, data.hiddenNodes, data.outputNodes);
    nn.weightsIH = data.weightsIH;
    nn.weightsHO = data.weightsHO;
    nn.biasH = data.biasH;
    nn.biasO = data.biasO;
    return nn;
  }
}
