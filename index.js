import express from 'express';
import bodyParser from 'body-parser';
import mysql from 'mysql2/promise';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 4000;

app.use(bodyParser.json());
app.use(cors());

// MySQL connection setup
let pool;
(async () => {
    try {
        pool = await mysql.createPool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('MySQL pool created.');
    } catch (error) {
        console.error('Error creating MySQL pool:', error);
        process.exit(1); // Exit the application with an error
    }
})();

app.post('/run', async (req, res) => {
    const { preferred_code_language, std_in, source_code } = req.body;
    try {
        if (!source_code) {
            throw new Error('Source code is missing');
        }

        // Insert the code snippet into the database
      
        // Language ID mappings
        const languageIds = {
            Python: 71,       // Python
            Java: 62,         // Java
            JavaScript: 63,   // JavaScript
            'C++': 52         // C++
        };

        const languageId = languageIds[preferred_code_language];
        if (!languageId) {
            throw new Error('Invalid preferred code language');
        }

        // Send the code snippet to Judge0 API for execution
        const response = await fetch('https://judge0-ce.p.rapidapi.com/submissions/?base64_encoded=true&wait=true', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
            },
            body: JSON.stringify({
                language_id: languageId,
                source_code: Buffer.from(source_code).toString('base64'),
                stdin: Buffer.from(std_in).toString('base64')
            })
        });

        const responseData = await response.text(); // Read response as text for logging
        // Log response data

        let resultData = null;
        try {
            resultData = JSON.parse(responseData); // Try parsing as JSON
        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);
        }

        if (!resultData || !resultData.token) {
            throw new Error('Failed to run code snippet. Invalid response from Judge0 API.');
        }

        const submissionId = resultData.token;

        // Poll Judge0 API for the result
        let resultResponse;
        do {
            resultResponse = await fetch(`https://judge0-ce.p.rapidapi.com/submissions/${submissionId}?base64_encoded=true`, {
                headers: {
                    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
                }
            });
            resultData = await resultResponse.json();

            if (resultData.status.id <= 2) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before polling again
            } else {
                break;
            }
        } while (resultResponse.status === 200 && resultData.status.id <= 2);

        if (resultData.status.id !== 3) {
            throw new Error('Execution error');
        }

        // Decode the output from base64 and send it to the frontend
        const decodedOutput = Buffer.from(resultData.stdout, 'base64').toString('utf-8');


        console.log(decodedOutput)

        res.status(201).json({ output: decodedOutput }); // Return the decoded output in the response
    } catch (error) {
        console.error('Error running code snippet:', error);
        res.status(500).json({ error: 'Error running code snippet' });
    }
   
});

app.post('/submit', async (req, res) => {
    const { user_name, preferred_code_language, std_in, source_code } = req.body;
    const timestamp = new Date(); // Use a Date object for timestamp

    try {
        if (!source_code) {
            throw new Error('Source code is missing');
        }

        // Insert the code snippet into the database
        const [results] = await pool.query('INSERT INTO tuf (user_name, preferred_code_language, std_in, source_code, timestamp) VALUES (?, ?, ?, ?, ?)', [user_name, preferred_code_language, std_in, source_code, timestamp]);

        // Language ID mappings
        const languageIds = {
            Python: 71,       // Python
            Java: 62,         // Java
            JavaScript: 63,   // JavaScript
            'C++': 52         // C++
        };

        const languageId = languageIds[preferred_code_language];
        if (!languageId) {
            throw new Error('Invalid preferred code language');
        }

        // Send the code snippet to Judge0 API for execution
        const response = await fetch('https://judge0-ce.p.rapidapi.com/submissions/?base64_encoded=true&wait=true', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
            },
            body: JSON.stringify({
                language_id: languageId,
                source_code: Buffer.from(source_code).toString('base64'),
                stdin: Buffer.from(std_in).toString('base64')
            })
        });

        const responseData = await response.text(); // Read response as text for logging
        console.log('Response data:', responseData); // Log response data

        let resultData = null;
        try {
            resultData = JSON.parse(responseData); // Try parsing as JSON
        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);
        }

        if (!resultData || !resultData.token) {
            throw new Error('Failed to submit code snippet. Invalid response from Judge0 API.');
        }

        const submissionId = resultData.token;

        // Poll Judge0 API for the result
        let resultResponse;
        do {
            resultResponse = await fetch(`https://judge0-ce.p.rapidapi.com/submissions/${submissionId}?base64_encoded=true`, {
                headers: {
                    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
                }
            });
            resultData = await resultResponse.json();

            if (resultData.status.id <= 2) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before polling again
            } else {
                break;
            }
        } while (resultResponse.status === 200 && resultData.status.id <= 2);

        if (resultData.status.id !== 3) {
            throw new Error('Execution error');
        }

        // Decode the output from base64 and send it to the frontend
        const decodedOutput = Buffer.from(resultData.stdout, 'base64').toString('utf-8');

        // Update the std_out column in the database with the output
        await pool.execute('UPDATE tuf SET std_out = ? WHERE id = ?', [decodedOutput, results.insertId]);

        res.status(201).json({ output: decodedOutput }); // Return the decoded output in the response
    } catch (error) {
        console.error('Error submitting code snippet:', error);
        res.status(500).json({ error: 'Error submitting code snippet' });
    }
});

// Get all entries route
app.get('/entries', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id,user_name, preferred_code_language, std_in, std_out, timestamp, LEFT(source_code, 100) as source_code FROM tuf');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching snippets from MySQL:', error);
        res.sendStatus(500);
    }
});

// Start the server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Close the MySQL connection pool when the application is shutting down
process.on('SIGINT', () => {
    console.log('Closing MySQL pool.');
    pool.end(); // Close the pool
    server.close(); // Close the server
    process.exit(0);
});
