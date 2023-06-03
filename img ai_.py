import openai
# Set up your OpenAI API key
openai.api_key = #'OpenAI API Key here'

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
