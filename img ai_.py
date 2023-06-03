import openai
#	https://api.openai.com/v1/chat/completions
#   https://api.openai.com/v1/completions
# API= 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
# API= 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
# Set up your OpenAI API key
openai.api_key = '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'

# Define a function to generate a response from the ChatGPT model
def generate_response(prompt):
    response = openai.Completion.create(
        engine='text-davinci-003',  # Choose the ChatGPT model
        prompt=prompt,
        max_tokens=50,  # Adjust the desired length of the response
        temperature=0.7,  # Controls the randomness of the output
        n=1,  # Generate a single response
        stop=None  # Specify a stopping condition if needed
    )

    return response.choices[0].text.strip()

# Example usage
user_input = input("You: ")

while user_input != 'exit':
    prompt = "User: " + user_input + "\nAI: "
    response = generate_response(prompt)
    print("AI:", response)
    user_input = input("You: ")
